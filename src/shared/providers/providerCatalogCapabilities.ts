/**
 * Catalog capability evidence tables.
 *
 * Provider-protocol tool support, model-level tool-calling evidence, and
 * model-level capability overrides consumed by the registry resolver so every
 * consumer (Chat, Work, model selectors, capability fallbacks) receives the
 * same answer.
 */

import {
  ApiFormat,
  ModelCapabilityStatus,
  ProviderName,
  type ModelCapabilities,
} from './providerIdentities';

/**
 * Tool support verified for the provider protocol used by catalog models.
 *
 * This is deliberately not a provider-wide fallback for arbitrary model IDs:
 * accepting an endpoint protocol does not prove that every model routed through
 * that endpoint can emit tool calls. Explicit model metadata and runtime probes
 * still override the optimistic fallback used for unverified models.
 */
export const CATALOG_PROVIDER_TOOL_CAPABILITIES: Readonly<
  Record<string, Partial<Record<ApiFormat, ModelCapabilityStatus>>>
> = {
  [ProviderName.OpenAI]: { [ApiFormat.OpenAI]: ModelCapabilityStatus.Supported },
  [ProviderName.Gemini]: { [ApiFormat.Gemini]: ModelCapabilityStatus.Supported },
  [ProviderName.Anthropic]: { [ApiFormat.Anthropic]: ModelCapabilityStatus.Supported },
  [ProviderName.DeepSeek]: {
    [ApiFormat.OpenAI]: ModelCapabilityStatus.Supported,
    [ApiFormat.Anthropic]: ModelCapabilityStatus.Supported,
  },
  [ProviderName.Moonshot]: {
    [ApiFormat.OpenAI]: ModelCapabilityStatus.Supported,
    [ApiFormat.Anthropic]: ModelCapabilityStatus.Unsupported,
  },
  [ProviderName.Qwen]: {
    [ApiFormat.OpenAI]: ModelCapabilityStatus.Supported,
    [ApiFormat.Anthropic]: ModelCapabilityStatus.Supported,
  },
  [ProviderName.Zhipu]: {
    [ApiFormat.OpenAI]: ModelCapabilityStatus.Supported,
    [ApiFormat.Anthropic]: ModelCapabilityStatus.Supported,
  },
  [ProviderName.Minimax]: {
    [ApiFormat.OpenAI]: ModelCapabilityStatus.Supported,
    [ApiFormat.Anthropic]: ModelCapabilityStatus.Supported,
  },
  [ProviderName.Qianfan]: { [ApiFormat.OpenAI]: ModelCapabilityStatus.Supported },
  [ProviderName.Xiaomi]: {
    [ApiFormat.OpenAI]: ModelCapabilityStatus.Supported,
    [ApiFormat.Anthropic]: ModelCapabilityStatus.Supported,
  },
  [ProviderName.StepFun]: { [ApiFormat.OpenAI]: ModelCapabilityStatus.Supported },
  [ProviderName.Volcengine]: {
    [ApiFormat.OpenAI]: ModelCapabilityStatus.Supported,
    [ApiFormat.Anthropic]: ModelCapabilityStatus.Supported,
  },
};

/**
 * Catalog models with current model-level tool-calling evidence.
 *
 * Keep this separate from protocol support: an endpoint accepting `tools`
 * does not mean every model routed through it can produce tool calls. Sources
 * are the providers' current model support tables (OpenAI Models, Gemini
 * Function Calling, Claude Tool Use, DeepSeek Tool Calls, Alibaba Model Studio
 * Function Calling, Zhipu Tool Calling, MiniMax API Overview, Qianfan Function
 * Calling, StepFun Tool Call, and MiMo release notes). Models absent from those
 * tables deliberately remain Unknown.
 */
export const CATALOG_TOOL_CALLING_MODEL_IDS: Readonly<Record<string, readonly string[]>> = {
  [ProviderName.OpenAI]: [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.4',
    'gpt-5.2',
    'gpt-5.3-codex',
    'gpt-5.2-codex',
  ],
  [ProviderName.Gemini]: ['gemini-3.1-pro-preview'],
  [ProviderName.Anthropic]: ['claude-sonnet-4-5-20250929', 'claude-sonnet-4-6', 'claude-opus-4-6'],
  [ProviderName.DeepSeek]: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  [ProviderName.Moonshot]: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.5'],
  [ProviderName.Qwen]: [
    'qwen3.7-max',
    'qwen3.7-plus',
    'qwen3.6-plus',
    'qwen3.5-plus',
    'qwen3-coder-next',
    'qwen3-coder-plus',
  ],
  [ProviderName.Zhipu]: ['glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7'],
  [ProviderName.Minimax]: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
  [ProviderName.Qianfan]: ['deepseek-v3.2'],
  [ProviderName.StepFun]: ['step-3.7-flash', 'step-3.5-flash'],
  [ProviderName.Xiaomi]: ['mimo-v2.5-pro', 'mimo-v2.5'],
  [ProviderName.Volcengine]: [
    'doubao-seed-2-0-pro-260215',
    'doubao-seed-2-0-lite-260215',
    'doubao-seed-2-0-mini-260215',
  ],
  [ProviderName.Grok]: ['grok-4.5'],
};

/**
 * Model-level capability facts that are not expressible by supportsImage alone.
 * Keep these overrides close to the registry resolver so every consumer (Chat,
 * Work, model selectors, and capability fallbacks) receives the same answer.
 * Unknown media capabilities intentionally stay Unknown until the provider
 * documents a stable request shape for them.
 */
export const CATALOG_MODEL_CAPABILITIES: Readonly<
  Record<string, Readonly<Record<string, Partial<ModelCapabilities>>>>
> = {
  [ProviderName.OpenAI]: {
    'gpt-5.6-sol': {
      toolCalling: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'gpt-5.6-terra': {
      toolCalling: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'gpt-5.6-luna': {
      toolCalling: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'gpt-5.4': {
      toolCalling: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'gpt-5.2': {
      toolCalling: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'gpt-5.3-codex': {
      toolCalling: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'gpt-5.2-codex': {
      toolCalling: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
  },
  [ProviderName.Anthropic]: {
    'claude-sonnet-4-5-20250929': {
      toolCalling: ModelCapabilityStatus.Supported,
      documentInput: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'claude-sonnet-4-6': {
      toolCalling: ModelCapabilityStatus.Supported,
      documentInput: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'claude-opus-4-6': {
      toolCalling: ModelCapabilityStatus.Supported,
      documentInput: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
  },
  [ProviderName.Gemini]: {
    'gemini-3-pro-preview': {
      toolCalling: ModelCapabilityStatus.Supported,
      documentInput: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'gemini-3.1-pro-preview': {
      toolCalling: ModelCapabilityStatus.Supported,
      documentInput: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'gemini-3-flash-preview': {
      toolCalling: ModelCapabilityStatus.Supported,
      documentInput: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
  },
  [ProviderName.DeepSeek]: {
    'deepseek-v4-flash': { reasoning: ModelCapabilityStatus.Supported },
    'deepseek-v4-pro': { reasoning: ModelCapabilityStatus.Supported },
  },
  [ProviderName.Moonshot]: {
    'kimi-k3': {
      videoInput: ModelCapabilityStatus.Supported,
      audioInput: ModelCapabilityStatus.Unsupported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'kimi-k2.6': {
      videoInput: ModelCapabilityStatus.Supported,
      audioInput: ModelCapabilityStatus.Unsupported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'kimi-k2.5': {
      videoInput: ModelCapabilityStatus.Supported,
      audioInput: ModelCapabilityStatus.Unsupported,
      reasoning: ModelCapabilityStatus.Supported,
    },
  },
  [ProviderName.Qwen]: {
    'qwen3.7-max': { reasoning: ModelCapabilityStatus.Supported },
    'qwen3.7-plus': {
      videoInput: ModelCapabilityStatus.Supported,
      audioInput: ModelCapabilityStatus.Unsupported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'qwen3.6-plus': {
      videoInput: ModelCapabilityStatus.Supported,
      audioInput: ModelCapabilityStatus.Unsupported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'qwen3.5-plus': {
      videoInput: ModelCapabilityStatus.Supported,
      audioInput: ModelCapabilityStatus.Unsupported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'qwen3-coder-plus': { reasoning: ModelCapabilityStatus.Supported },
    'qwen3-coder-next': { reasoning: ModelCapabilityStatus.Supported },
  },
  [ProviderName.Zhipu]: {
    'glm-5.2': { reasoning: ModelCapabilityStatus.Supported },
    'glm-5': { reasoning: ModelCapabilityStatus.Supported },
    'glm-5-turbo': { reasoning: ModelCapabilityStatus.Supported },
    'glm-4.7': { reasoning: ModelCapabilityStatus.Supported },
  },
  [ProviderName.Minimax]: {
    'MiniMax-M3': {
      videoInput: ModelCapabilityStatus.Supported,
      audioInput: ModelCapabilityStatus.Unsupported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'MiniMax-M2.7': { reasoning: ModelCapabilityStatus.Supported },
    'MiniMax-M2.5': { reasoning: ModelCapabilityStatus.Supported },
  },
  [ProviderName.Volcengine]: {
    'doubao-seed-2-0-pro-260215': {
      videoInput: ModelCapabilityStatus.Supported,
      audioInput: ModelCapabilityStatus.Unsupported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'doubao-seed-2-0-lite-260215': {
      videoInput: ModelCapabilityStatus.Supported,
      audioInput: ModelCapabilityStatus.Unsupported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'doubao-seed-2-0-mini-260215': {
      videoInput: ModelCapabilityStatus.Supported,
      audioInput: ModelCapabilityStatus.Unsupported,
      reasoning: ModelCapabilityStatus.Supported,
    },
  },
  [ProviderName.StepFun]: {
    'step-3.7-flash': {
      videoInput: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
    'step-3.5-flash': { reasoning: ModelCapabilityStatus.Supported },
  },
  [ProviderName.Xiaomi]: {
    'mimo-v2.5-pro': { reasoning: ModelCapabilityStatus.Supported },
    'mimo-v2.5': {
      videoInput: ModelCapabilityStatus.Supported,
      audioInput: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
  },
  [ProviderName.Grok]: {
    'grok-4.5': {
      toolCalling: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
  },
};
