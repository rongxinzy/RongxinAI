import type { MagpieModel, MagpieProviderSummary } from '../../../shared/magpie/types';

type MagpieNativeApi = 'openai-responses' | 'anthropic-messages' | 'openai-completions';

/**
 * Restore upstream vendor compatibility hints on loopback Magpie models.
 *
 * Because Magpie registers models under `provider: 'magpie'` and a `127.0.0.1`
 * gateway URL, `pi-ai`'s `detectCompat()` cannot infer vendor quirks from URL
 * or provider id alone. Supplying explicit `compat` preserves reasoning
 * formats, `max_tokens` vs `max_completion_tokens`, and avoids sending
 * unsupported `role: 'developer'` or `store` parameters to compatible APIs.
 */
export function resolveMagpieModelCompat(
  selected: MagpieModel,
  api: MagpieNativeApi,
  upstreamProvider?: MagpieProviderSummary,
): Record<string, unknown> {
  if (api !== 'openai-completions') {
    return { sendSessionAffinityHeaders: true };
  }

  const baseUrl = (upstreamProvider?.baseUrl ?? '').toLowerCase();
  const providerId = (upstreamProvider?.id ?? '').toLowerCase();
  const ownedBy = (selected.owned_by ?? '').toLowerCase();
  const modelId = selected.id.toLowerCase();
  const slashIndex = modelId.indexOf('/');
  const modelPrefix = slashIndex >= 0 ? modelId.slice(0, slashIndex) : '';
  const modelSuffix = slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;

  const isOpenRouter =
    providerId.includes('openrouter') ||
    baseUrl.includes('openrouter.ai') ||
    modelPrefix === 'openrouter';
  if (isOpenRouter) {
    const isAnthropicModel =
      modelSuffix.startsWith('anthropic/') || modelId.startsWith('anthropic/');
    const isAnthropicOrOpenAIModel =
      isAnthropicModel || modelSuffix.startsWith('openai/') || modelId.startsWith('openai/');
    return {
      sendSessionAffinityHeaders: true,
      thinkingFormat: 'openrouter',
      sessionAffinityFormat: 'openrouter',
      supportsDeveloperRole: isAnthropicOrOpenAIModel,
      ...(isAnthropicModel ? { cacheControlFormat: 'anthropic' } : {}),
    };
  }

  const isDeepSeek =
    providerId.includes('deepseek') ||
    baseUrl.includes('deepseek.com') ||
    ownedBy.includes('deepseek') ||
    modelPrefix === 'deepseek' ||
    modelSuffix.startsWith('deepseek-');
  if (isDeepSeek) {
    return {
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: 'deepseek',
    };
  }

  const isZai =
    providerId === 'zai' ||
    providerId.startsWith('zai-') ||
    providerId.includes('zhipu') ||
    baseUrl.includes('api.z.ai') ||
    baseUrl.includes('open.bigmodel.cn') ||
    ownedBy.includes('zhipu') ||
    ownedBy === 'zai' ||
    modelPrefix === 'zhipu' ||
    modelPrefix === 'zai' ||
    modelSuffix.startsWith('glm-');
  if (isZai) {
    return {
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: (selected.supported_reasoning_levels?.length ?? 0) > 0,
      maxTokensField: 'max_tokens',
      thinkingFormat: 'zai',
    };
  }

  const isMoonshot =
    providerId.includes('moonshot') ||
    providerId.includes('kimi') ||
    baseUrl.includes('api.moonshot.') ||
    ownedBy.includes('moonshot') ||
    modelPrefix === 'moonshot' ||
    modelPrefix === 'kimi' ||
    modelSuffix.startsWith('kimi-') ||
    modelSuffix.startsWith('moonshot-');
  if (isMoonshot) {
    return {
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: (selected.supported_reasoning_levels?.length ?? 0) > 0,
      maxTokensField: 'max_tokens',
      requiresReasoningContentOnAssistantMessages: true,
    };
  }

  const isXai =
    providerId === 'xai' ||
    providerId.startsWith('xai-') ||
    baseUrl.includes('api.x.ai') ||
    ownedBy.includes('xai') ||
    modelPrefix === 'xai' ||
    modelSuffix.startsWith('grok-');
  if (isXai) {
    return {
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    };
  }

  const isTogether =
    providerId.includes('together') ||
    baseUrl.includes('api.together.ai') ||
    baseUrl.includes('api.together.xyz') ||
    ownedBy.includes('together');
  if (isTogether) {
    return {
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: 'max_tokens',
      thinkingFormat: 'together',
      supportsLongCacheRetention: false,
    };
  }

  const isNvidia = providerId.includes('nvidia') || baseUrl.includes('integrate.api.nvidia.com');
  if (isNvidia) {
    return {
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: 'max_tokens',
      supportsLongCacheRetention: false,
    };
  }

  const isCerebras = providerId.includes('cerebras') || baseUrl.includes('cerebras.ai');
  if (isCerebras) {
    return {
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      supportsLongCacheRetention: false,
    };
  }

  const isOfficialOpenAI =
    baseUrl.includes('api.openai.com') ||
    (!baseUrl && (providerId === 'openai' || modelPrefix === 'openai' || ownedBy === 'openai'));
  if (isOfficialOpenAI) {
    return {
      sendSessionAffinityHeaders: true,
      supportsStore: true,
      supportsDeveloperRole: true,
      maxTokensField: 'max_completion_tokens',
    };
  }

  // Default for generic / Qwen / DashScope / MiniMax / Ollama / llama.cpp / LAN servers.
  return {
    sendSessionAffinityHeaders: true,
    supportsStore: false,
    supportsDeveloperRole: false,
    maxTokensField: 'max_tokens',
  };
}

/**
 * Calibrate output token ceiling when the catalog omits `max_output_tokens`,
 * scaling safely with larger context windows while guarding small-window models.
 */
export function resolveMagpieFallbackMaxTokens(
  selected: MagpieModel,
  contextWindow: number,
  defaultLocalMaxTokens: number,
): number {
  if (typeof selected.max_output_tokens === 'number' && selected.max_output_tokens > 0) {
    return Math.min(selected.max_output_tokens, contextWindow);
  }
  const fallback =
    selected.reasoning === true
      ? contextWindow >= 65536
        ? 32768
        : 16384
      : contextWindow >= 65536
        ? 16384
        : defaultLocalMaxTokens;
  return Math.min(
    fallback,
    Math.max(defaultLocalMaxTokens, Math.floor(contextWindow / 2)),
    contextWindow,
  );
}
