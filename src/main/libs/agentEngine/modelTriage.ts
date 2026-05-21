import type { TriageConfig, TriageResult, TriageState, TriageTier } from '../../../shared/triage';
import { TRIAGE_TIER_ORDER } from '../../../shared/triage';

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
