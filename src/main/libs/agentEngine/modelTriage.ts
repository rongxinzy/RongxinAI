import type { TriageConfig, TriageResult, TriageState, TriageTier } from '../../../shared/triage';
import { TRIAGE_TIER_ORDER } from '../../../shared/triage';

const LLAMACPP_BASE_URL = 'http://127.0.0.1:8080';
const TRIAGE_LOCAL_MODEL_TIMEOUT_MS = 3_000;

/**
 * Build a classifier-friendly snippet from user input.
 * Truncate to 200 chars to keep the classification fast and prevent prompt injection.
 */
function truncateForClassification(prompt: string): string {
  const singleLine = prompt.replace(/\n/g, ' ').trim();
  if (singleLine.length <= 200) return singleLine;
  return singleLine.slice(0, 197) + '...';
}

/**
 * Classify a user message using rule-based heuristics.
 *
 * Returns a TriageResult with the recommended tier and optional model override.
 * If modelRef is null, the current model should be kept unchanged.
 */
export function classifyByRules(
  prompt: string,
  conversationDepth: number,
  config: TriageConfig,
): TriageResult {
  if (conversationDepth > config.rules.maxConversationRoundsForTriage) {
    return { tier: 'standard', modelRef: null, reason: 'deep-conversation' };
  }

  const trimmed = prompt.trim();
  const len = trimmed.length;
  const hasCode = /```[\s\S]*?```/.test(prompt);
  const hasInlineCode = /`[^`]+`/.test(prompt);
  const isGreeting =
    /^(你好|hi\b|hello\b|hey\b|早上好|晚上好|下午好|再见|bye\b|谢谢|thank)/i.test(trimmed);
  const isSimpleFact =
    /^(什么是|who is|when did|where is|how many|what is|几点|天气|日期|今天.*几)/i.test(trimmed);
  const isComplex =
    /(为什么|怎么实现|如何设计|分析|架构|重构|review|解释.*原理|compare|区别|源码|底层|原理|设计模式)/.test(prompt) ||
    /(write|implement|refactor|explain|analyze|design|optimize|debug|fix.*bug)/i.test(prompt);
  const hasFilePath =
    /(?:^|\s)([\w./-]*\/[\w./-]+\.[\w]{1,6})(?:\s|$)/.test(prompt) ||
    /(?:^|\s)([A-Za-z]:\\[\w\\./-]+\.\w{1,6})(?:\s|$)/.test(prompt);
  const isTranslation =
    /(翻译|translate|译成|翻成|用.*怎么说)/i.test(prompt) && len < 200;
  const isSummaryRequest =
    /(总结|概括|摘要|summarize|summarize|tl;dr)/i.test(prompt) && len > 500;

  // light tier: short greetings, simple facts, translations
  if (len < 60 && (isGreeting || isSimpleFact) && !hasCode) {
    if (config.rules.lightModelRef) {
      return { tier: 'light', modelRef: config.rules.lightModelRef, reason: `light: ${isGreeting ? 'greeting' : 'simple-fact'}` };
    }
    return { tier: 'light', modelRef: null, reason: 'light-rule-match-no-model' };
  }

  if (isTranslation && config.rules.lightModelRef) {
    return { tier: 'light', modelRef: config.rules.lightModelRef, reason: 'light: translation' };
  }

  // heavy tier: code generation, architecture analysis, complex reasoning, summarization
  if (
    (hasCode && len > 200) ||
    (isComplex && len > 80) ||
    hasFilePath ||
    isSummaryRequest
  ) {
    if (config.rules.heavyModelRef) {
      return { tier: 'heavy', modelRef: config.rules.heavyModelRef, reason: `heavy: ${[
        hasCode ? 'code' : '',
        isComplex ? 'complex' : '',
        hasFilePath ? 'file' : '',
        isSummaryRequest ? 'summary' : '',
      ].filter(Boolean).join('+')}` };
    }
    return { tier: 'heavy', modelRef: null, reason: 'heavy-rule-match-no-model' };
  }

  // medium-length code snippets: standard
  if ((hasCode || hasInlineCode) && len <= 200) {
    return { tier: 'standard', modelRef: null, reason: 'standard: small-code' };
  }

  return { tier: 'standard', modelRef: null, reason: 'default' };
}

/**
 * Check whether a tier switch should be allowed given hysteresis control.
 *
 * Switching up (light→standard, standard→heavy) is always allowed.
 * Switching down must respect the cooldown period.
 */
export function shouldAllowSwitch(
  newTier: TriageTier,
  currentRound: number,
  state: TriageState,
  cooldownRounds: number,
): boolean {
  if (newTier === state.activeTier) return true;

  const newOrder = TRIAGE_TIER_ORDER[newTier];
  const activeOrder = TRIAGE_TIER_ORDER[state.activeTier];

  // Always allow switching up
  if (newOrder > activeOrder) return true;

  // Switching down: respect cooldown
  return currentRound - state.lastSwitchRound >= cooldownRounds;
}

/**
 * Extract the provider prefix from a model ref.
 * e.g. "openai/gpt-5.4" → "openai", "ollama/qwen2.5:0.5b" → "ollama"
 */
export function extractProviderId(modelRef: string): string | null {
  const idx = modelRef.indexOf('/');
  if (idx <= 0) return null;
  return modelRef.slice(0, idx);
}

/**
 * Create a fresh triage state for a new session.
 */
export function createTriageState(): TriageState {
  return {
    lastSwitchRound: 0,
    activeTier: 'standard',
  };
}

// ─── Phase 2.1b: Local model classification ──────────────────────────────

/**
 * Classification prompt sent to the local model.
 * The user message is appended after this system prompt.
 *
 * Design goals:
 * - Isolate classification from user content (separate system prompt)
 * - Request structured output (single word)
 * - Keep the prompt small for fast inference on small models
 */
const TRIAGE_CLASSIFIER_PROMPT = `Classify the following user message into exactly one category:
- light: simple greeting, thanks, goodbye, small talk, simple factual question, short translation
- standard: normal conversation, general question, moderate instruction
- heavy: complex coding task, architecture design, debugging, long analysis, refactoring

Reply with only one word: light, standard, or heavy.`;

interface LocalClassificationResponse {
  category: 'light' | 'standard' | 'heavy' | null;
  error?: string;
}

/**
 * Classify a user message using a local llama.cpp model.
 *
 * Sends the classification prompt + truncated user message to the
 * llama.cpp server's /v1/chat/completions endpoint.
 *
 * Returns null on any failure — caller should fall back to standard tier.
 */
export async function classifyByLocalModel(
  prompt: string,
  triageModelName: string,
  config: TriageConfig,
): Promise<TriageResult | null> {
  const truncated = truncateForClassification(prompt);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRIAGE_LOCAL_MODEL_TIMEOUT_MS);

  try {
    const response = await fetch(`${LLAMACPP_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: triageModelName,
        messages: [
          { role: 'system', content: TRIAGE_CLASSIFIER_PROMPT },
          { role: 'user', content: truncated },
        ],
        max_tokens: 5,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawText = body?.choices?.[0]?.message?.content?.trim().toLowerCase() || '';

    const category = parseClassificationResponse(rawText);
    if (!category) {
      return null;
    }

    return tierToResult(category, config);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseClassificationResponse(text: string): 'light' | 'standard' | 'heavy' | null {
  if (/\blight\b/.test(text)) return 'light';
  if (/\bheavy\b/.test(text)) return 'heavy';
  if (/\bstandard\b/.test(text)) return 'standard';
  return null;
}

function tierToResult(
  tier: 'light' | 'standard' | 'heavy',
  config: TriageConfig,
): TriageResult {
  if (tier === 'light' && config.rules.lightModelRef) {
    return { tier: 'light', modelRef: config.rules.lightModelRef, reason: 'llm: light' };
  }
  if (tier === 'heavy' && config.rules.heavyModelRef) {
    return { tier: 'heavy', modelRef: config.rules.heavyModelRef, reason: 'llm: heavy' };
  }
  return { tier, modelRef: null, reason: `llm: ${tier}` };
}
