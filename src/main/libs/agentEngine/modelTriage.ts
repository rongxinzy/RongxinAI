import type { TriageConfig, TriageResult, TriageState, TriageTier } from '../../../shared/triage';
import { TRIAGE_TIER_ORDER } from '../../../shared/triage';

import { classifyTierForTriage } from './piClassifierTriage';

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
  const isGreeting = /^(你好|hi\b|hello\b|hey\b|早上好|晚上好|下午好|再见|bye\b|谢谢|thank)/i.test(
    trimmed,
  );
  const isSimpleFact =
    /^(什么是|who is|when did|where is|how many|what is|几点|天气|日期|今天.*几)/i.test(trimmed);
  const isComplex =
    /(为什么|怎么实现|如何设计|分析|架构|重构|review|解释.*原理|compare|区别|源码|底层|原理|设计模式)/.test(
      prompt,
    ) || /(write|implement|refactor|explain|analyze|design|optimize|debug|fix.*bug)/i.test(prompt);
  const hasFilePath =
    /(?:^|\s)([\w./-]*\/[\w./-]+\.[\w]{1,6})(?:\s|$)/.test(prompt) ||
    /(?:^|\s)([A-Za-z]:\\[\w\\./-]+\.\w{1,6})(?:\s|$)/.test(prompt);
  const isTranslation = /(翻译|translate|译成|翻成|用.*怎么说)/i.test(prompt) && len < 200;
  const isSummaryRequest = /(总结|概括|摘要|summarize|summarize|tl;dr)/i.test(prompt) && len > 500;

  // light tier: short greetings, simple facts, translations
  if (len < 60 && (isGreeting || isSimpleFact) && !hasCode) {
    if (config.rules.lightModelRef) {
      return {
        tier: 'light',
        modelRef: config.rules.lightModelRef,
        reason: `light: ${isGreeting ? 'greeting' : 'simple-fact'}`,
      };
    }
    return { tier: 'light', modelRef: null, reason: 'light-rule-match-no-model' };
  }

  if (isTranslation && config.rules.lightModelRef) {
    return { tier: 'light', modelRef: config.rules.lightModelRef, reason: 'light: translation' };
  }

  // heavy tier: code generation, architecture analysis, complex reasoning, summarization
  if ((hasCode && len > 200) || (isComplex && len > 80) || hasFilePath || isSummaryRequest) {
    if (config.rules.heavyModelRef) {
      return {
        tier: 'heavy',
        modelRef: config.rules.heavyModelRef,
        reason: `heavy: ${[
          hasCode ? 'code' : '',
          isComplex ? 'complex' : '',
          hasFilePath ? 'file' : '',
          isSummaryRequest ? 'summary' : '',
        ]
          .filter(Boolean)
          .join('+')}`,
      };
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

/**
 * Full triage classification pipeline:
 * 1. Try rule-based classification first (<1ms)
 * 2. If result is ambiguous and local model triage is enabled,
 *    try LLM-based classification (100-500ms, 3s timeout)
 * 3. If all else fails, return standard tier
 */
export async function classifyMessage(
  prompt: string,
  conversationDepth: number,
  config: TriageConfig,
): Promise<TriageResult> {
  const ruleResult = classifyByRules(prompt, conversationDepth, config);

  // Definitive rule matches — return immediately
  if (ruleResult.reason.startsWith('light:') || ruleResult.reason.startsWith('heavy:')) {
    return ruleResult;
  }
  if (
    ruleResult.reason === 'deep-conversation' ||
    ruleResult.reason === 'heavy-rule-match-no-model'
  ) {
    return ruleResult;
  }

  // Ambiguous cases — try local model if configured
  if (config.rules.useLocalModelTriage && config.rules.triageModelName) {
    const llmResult = await classifyByLocalModel(prompt, config.rules.triageModelName, config);
    if (llmResult) {
      return llmResult;
    }
  }

  return ruleResult;
}

// ─── Local model classification (pi classifier) ───────────────────────────

/**
 * Classify a user message with the configured llama.cpp classifier model.
 *
 * pi's llama-cpp-classify API reads next-token label probabilities from the
 * server root configured in `rules.classifierBaseUrl` — no full generation,
 * no hardcoded port. Returns null on any failure so the caller keeps the
 * rule-based result.
 */
export async function classifyByLocalModel(
  prompt: string,
  triageModelName: string,
  config: TriageConfig,
): Promise<TriageResult | null> {
  const baseUrl = config.rules.classifierBaseUrl;
  if (!baseUrl || !triageModelName) return null;

  const classified = await classifyTierForTriage(prompt, baseUrl, triageModelName);
  if (!classified) return null;

  return tierToResult(classified.tier, config, classified.confidence);
}

function tierToResult(
  tier: 'light' | 'standard' | 'heavy',
  config: TriageConfig,
  confidence?: number,
): TriageResult {
  const suffix = confidence !== undefined ? ` (${confidence.toFixed(2)})` : '';
  if (tier === 'light' && config.rules.lightModelRef) {
    return { tier: 'light', modelRef: config.rules.lightModelRef, reason: `llm: light${suffix}` };
  }
  if (tier === 'heavy' && config.rules.heavyModelRef) {
    return { tier: 'heavy', modelRef: config.rules.heavyModelRef, reason: `llm: heavy${suffix}` };
  }
  return { tier, modelRef: null, reason: `llm: ${tier}${suffix}` };
}

/**
 * Decide whether a triage result should switch the session model.
 *
 * Pure decision function: hysteresis (switching down respects the cooldown),
 * provider gating (cross-provider switches need an explicit opt-in), and
 * same-model short-circuit. Callers own applying the modelRef and storing the
 * returned state.
 */
export function chooseTriageModelSwitch(
  currentModelRef: string,
  result: TriageResult,
  state: TriageState,
  config: TriageConfig,
  currentRound: number,
): { modelRef: string | null; state: TriageState } {
  if (!result.modelRef || result.modelRef === currentModelRef) {
    return { modelRef: null, state };
  }
  if (!shouldAllowSwitch(result.tier, currentRound, state, config.rules.cooldownRounds)) {
    return { modelRef: null, state };
  }
  if (!config.rules.allowCrossProviderSwitch) {
    const currentProvider = extractProviderId(currentModelRef);
    const nextProvider = extractProviderId(result.modelRef);
    if (currentProvider && nextProvider && currentProvider !== nextProvider) {
      return { modelRef: null, state };
    }
  }
  return {
    modelRef: result.modelRef,
    state: { lastSwitchRound: currentRound, activeTier: result.tier },
  };
}
