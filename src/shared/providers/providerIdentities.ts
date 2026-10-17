/**
 * Provider identity & capability vocabulary.
 *
 * String literal constant groups for provider names, agent runtime provider
 * IDs, API formats, model capability status, and model entry origins. Shared
 * by every provider module; both main and renderer processes import from here.
 *
 * Follows the same pattern as PlatformRegistry in src/shared/platform/.
 * String literal constants follow AGENTS.md "String Literal Constants" spec,
 * modeled after src/scheduledTask/constants.ts.
 */

import { ZhiyuanModelPool } from '../modelPool/constants';

// providerName identifies the ZhiYuanAgent internal provider (config key).
export const ProviderName = {
  Zhiyuan: ZhiyuanModelPool.ProviderId,
  OpenAI: 'openai',
  Gemini: 'gemini',
  Anthropic: 'anthropic',
  DeepSeek: 'deepseek',
  Moonshot: 'moonshot',
  Zhipu: 'zhipu',
  Minimax: 'minimax',
  Qwen: 'qwen',
  Qianfan: 'qianfan',
  Xiaomi: 'xiaomi',
  StepFun: 'stepfun',
  Volcengine: 'volcengine',
  OpenRouter: 'openrouter',
  Grok: 'grok',
  LlamaCpp: 'llamacpp',
  Ollama: 'ollama',
  Custom: 'custom',
  Copilot: 'github-copilot',
  Magpie: 'magpie',
} as const;
export type ProviderName = (typeof ProviderName)[keyof typeof ProviderName];

// ─── Agent Runtime Provider ID ─────────────────────────────────────────
// Runtime provider identifiers may differ from ProviderName.
export const AgentProviderId = {
  Moonshot: 'moonshot',
  Google: 'google',
  Anthropic: 'anthropic',
  OpenAI: 'openai',
  OpenAICodex: 'openai-codex',
  DeepSeek: 'deepseek',
  Qianfan: 'qianfan',
  Qwen: 'qwen-portal',
  Zai: 'zai',
  Volcengine: 'volcengine',
  Minimax: 'minimax',
  StepFun: 'stepfun',
  Xiaomi: 'xiaomi',
  OpenRouter: 'openrouter',
  Grok: 'grok',
  Copilot: 'github-copilot',
  ZhiyuanCopilot: 'zhiyuan-copilot',
  LlamaCpp: 'llamacpp',
  Ollama: 'ollama',
  Zhiyuan: 'zhiyuan',
} as const;
export type AgentProviderId = (typeof AgentProviderId)[keyof typeof AgentProviderId];

// ─── API Format (provider default protocol format) ──────────────────────
export const ApiFormat = {
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  Gemini: 'gemini',
} as const;
export type ApiFormat = (typeof ApiFormat)[keyof typeof ApiFormat];

export const ModelCapabilityStatus = {
  Supported: 'supported',
  Unsupported: 'unsupported',
  Unknown: 'unknown',
} as const;
export type ModelCapabilityStatus =
  (typeof ModelCapabilityStatus)[keyof typeof ModelCapabilityStatus];

export const ProviderModelOrigin = {
  /** Entry added or saved through the settings model form; kept when the list mirrors the endpoint. */
  User: 'user',
  /** Entry owned by model discovery; removed by refresh once the endpoint stops listing it. */
  Discovered: 'discovered',
} as const;
export type ProviderModelOrigin = (typeof ProviderModelOrigin)[keyof typeof ProviderModelOrigin];

export interface ModelCapabilities {
  readonly toolCalling: ModelCapabilityStatus;
  readonly imageInput: ModelCapabilityStatus;
  readonly videoInput: ModelCapabilityStatus;
  readonly audioInput: ModelCapabilityStatus;
  readonly documentInput: ModelCapabilityStatus;
  readonly reasoning: ModelCapabilityStatus;
}

export const UNKNOWN_MODEL_CAPABILITIES: ModelCapabilities = {
  toolCalling: ModelCapabilityStatus.Unknown,
  imageInput: ModelCapabilityStatus.Unknown,
  videoInput: ModelCapabilityStatus.Unknown,
  audioInput: ModelCapabilityStatus.Unknown,
  documentInput: ModelCapabilityStatus.Unknown,
  reasoning: ModelCapabilityStatus.Unknown,
};
