/**
 * Provider Constants & Registry — Single Source of Truth
 *
 * All LLM provider identifiers, default configurations, and metadata are
 * defined here as a unified registry. Both main and renderer processes
 * import from this module.
 *
 * When adding a new provider:
 * 1. Add the provider key to ProviderName
 * 2. Add the runtime provider ID to AgentProviderId (if different)
 * 3. Add one record to the PROVIDER_DEFINITIONS array
 *    — that's it, types and lookups are derived automatically.
 *
 * Follows the same pattern as PlatformRegistry in src/shared/platform/.
 * String literal constants follow AGENTS.md "String Literal Constants" spec,
 * modeled after src/scheduledTask/constants.ts.
 */

// ═══════════════════════════════════════════════════════
// 1. String Literal Constants
// ═══════════════════════════════════════════════════════

// ─── Provider Name ──────────────────────────────────────────────────────
import {
  buildProviderModelIndex,
  getIndexedProviderModels,
  type ProviderModelIndex,
} from './modelCatalog';
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

// ─── Agent Runtime API Protocol ────────────────────────────────────────
export const AgentApi = {
  AnthropicMessages: 'anthropic-messages',
  OpenAICompletions: 'openai-completions',
  OpenAIResponses: 'openai-responses',
  OpenAICodexResponses: 'openai-codex-responses',
  GoogleGenerativeAI: 'google-generative-ai',
  Ollama: 'ollama',
} as const;
export type AgentApi = (typeof AgentApi)[keyof typeof AgentApi];

// ─── API Format (provider default protocol format) ──────────────────────
export const ApiFormat = {
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  Gemini: 'gemini',
} as const;
export type ApiFormat = (typeof ApiFormat)[keyof typeof ApiFormat];

// ─── Auth Type ──────────────────────────────────────────────────────────
export const AuthType = {
  ApiKey: 'api-key',
  OAuth: 'oauth',
} as const;
export type AuthType = (typeof AuthType)[keyof typeof AuthType];

export const ModelCapabilityStatus = {
  Supported: 'supported',
  Unsupported: 'unsupported',
  Unknown: 'unknown',
} as const;
export type ModelCapabilityStatus =
  (typeof ModelCapabilityStatus)[keyof typeof ModelCapabilityStatus];

export interface ModelCapabilities {
  readonly toolCalling: ModelCapabilityStatus;
  readonly imageInput: ModelCapabilityStatus;
  readonly videoInput: ModelCapabilityStatus;
  readonly audioInput: ModelCapabilityStatus;
  readonly documentInput: ModelCapabilityStatus;
  readonly reasoning: ModelCapabilityStatus;
}

const UNKNOWN_MODEL_CAPABILITIES: ModelCapabilities = {
  toolCalling: ModelCapabilityStatus.Unknown,
  imageInput: ModelCapabilityStatus.Unknown,
  videoInput: ModelCapabilityStatus.Unknown,
  audioInput: ModelCapabilityStatus.Unknown,
  documentInput: ModelCapabilityStatus.Unknown,
  reasoning: ModelCapabilityStatus.Unknown,
};

const MODEL_CATALOG_VERIFIED_AT = '2026-08-03';

const OfficialModelCatalogSourceUrl = {
  OpenAI: 'https://developers.openai.com/api/docs/models',
  DeepSeek: 'https://api-docs.deepseek.com/quick_start/pricing',
  MoonshotK3: 'https://platform.kimi.com/docs/guide/kimi-k3-quickstart',
  MoonshotK26: 'https://platform.kimi.com/docs/guide/kimi-k2-6-quickstart',
  Qwen: 'https://www.alibabacloud.com/help/en/model-studio/vision-model/',
  Zhipu: 'https://docs.bigmodel.cn/cn/guide/start/model-overview',
  MiniMax: 'https://platform.minimaxi.com/docs/api-reference/text-openai-api',
  Volcengine: 'https://ark.volcengine.com/region:cn-beijing/model',
  StepFun: 'https://platform.stepfun.com/docs/zh/guides/models/overview',
  Xiaomi: 'https://mimo.mi.com/docs/en-US/quick-start/summary/model',
} as const;

// ═══════════════════════════════════════════════════════
// 2. Provider Definition Shape
// ═══════════════════════════════════════════════════════

/**
 * A provider-owned model catalog entry.
 *
 * `id` is the identifier sent to the provider. Aliases are only lookup keys;
 * callers must continue sending the canonical `id` to avoid changing the
 * provider's request contract.
 */
export interface ProviderModelDefinition {
  readonly id: string;
  readonly name: string;
  readonly supportsImage: boolean;
  readonly aliases?: readonly string[];
  readonly capabilities?: Partial<ModelCapabilities>;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  /** Official documentation URL used when maintaining this catalog entry. */
  readonly sourceUrl?: string;
  /** Date on which the capacity/capability values were last checked. */
  readonly verifiedAt?: string;
}

interface ProviderDefInput {
  /** Provider identifier (e.g. 'openai', 'moonshot') */
  readonly id: string;
  /** Human-readable display name shown in UI, e.g. 'OpenAI', 'GitHub Copilot' */
  readonly label: string;
  /** Provider console / product website URL */
  readonly website?: string;
  /** API key creation page URL. Omit for providers that don't use API keys (e.g. Ollama). */
  readonly apiKeyUrl?: string;
  /** Default base URL */
  readonly defaultBaseUrl: string;
  /** Default API format */
  readonly defaultApiFormat: ApiFormat;
  /** Whether this provider supports codingPlan mode */
  readonly codingPlanSupported: boolean;
  /**
   * Coding Plan dedicated endpoints (only for codingPlanSupported=true providers).
   * openai: OpenAI-compatible format endpoint
   * anthropic: Anthropic-compatible format endpoint
   * Either field may be omitted for providers that only support one protocol.
   */
  readonly codingPlanUrls?: {
    readonly openai?: string;
    readonly anthropic?: string;
  };
  /**
   * When set, resolveCodingPlanBaseUrl will use this format (and its URL) regardless
   * of the caller's current apiFormat. Use for providers whose coding plan endpoint
   * only supports a single protocol (e.g. Zhipu coding plan is openai-only).
   */
  readonly preferredCodingPlanFormat?: 'openai' | 'anthropic';
  /**
   * Default baseUrl when switching apiFormat.
   * Used by Settings UI to auto-switch baseUrl when toggling anthropic/openai format.
   * If omitted, both formats use defaultBaseUrl.
   */
  readonly switchableBaseUrls?: {
    readonly anthropic: string;
    readonly openai: string;
  };
  /** Region grouping for UI visibility */
  readonly region: 'china' | 'global';
  /** Priority ordering for English locale display (lower = higher priority, 0 = no special priority) */
  readonly enPriority: number;
  /** Default model list */
  readonly defaultModels: readonly ProviderModelDefinition[];
  /**
   * Coding Plan dedicated model list (only meaningful when codingPlanSupported=true).
   * When the user toggles codingPlanEnabled in Settings, the model list is replaced
   * with this list. When unset, coding plan mode keeps the same models as defaultModels.
   */
  readonly codingPlanModels?: readonly ProviderModelDefinition[];
  /**
   * The runtime provider ID used when building model refs (e.g. "provider/modelId").
   * Most providers share the same value as `id`, but some differ
   * (e.g. zhipu → zai, gemini → google).
   * Used by renderer to construct scheduled-task model references without
   * importing main-process-only runtime configuration.
   */
  readonly agentProviderId: AgentProviderId;
}

// ═══════════════════════════════════════════════════════
// 3. Provider Definitions — the single source of truth
//    Array order = Chinese UI display order
//    (CHINA first, then GLOBAL, matching existing config.ts order).
// ═══════════════════════════════════════════════════════

const PROVIDER_DEFINITIONS = [
  {
    id: ProviderName.Zhiyuan,
    label: 'ZhiYuan',
    website: 'https://www.rongxzyai.com',
    apiKeyUrl: 'https://account.rongxzyai.com',
    agentProviderId: AgentProviderId.Zhiyuan,
    defaultBaseUrl: ZhiyuanModelPool.ProductionBaseUrl,
    defaultApiFormat: ApiFormat.OpenAI,
    codingPlanSupported: false,
    region: 'china',
    enPriority: 0,
    defaultModels: [
      {
        id: ZhiyuanModelPool.FreeModelId,
        name: 'ZhiYuan Free',
        supportsImage: false,
        contextWindow: 131_072,
        maxTokens: 32_768,
        capabilities: {
          toolCalling: ModelCapabilityStatus.Supported,
          imageInput: ModelCapabilityStatus.Unsupported,
          reasoning: ModelCapabilityStatus.Supported,
        },
      },
    ],
  },
  // ── China ──
  {
    id: ProviderName.DeepSeek,
    label: 'DeepSeek',
    website: 'https://platform.deepseek.com',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    agentProviderId: AgentProviderId.DeepSeek,
    defaultBaseUrl: 'https://api.deepseek.com/anthropic',
    defaultApiFormat: ApiFormat.Anthropic,
    codingPlanSupported: false,
    switchableBaseUrls: {
      anthropic: 'https://api.deepseek.com/anthropic',
      openai: 'https://api.deepseek.com',
    },
    region: 'china',
    enPriority: 0,
    defaultModels: [
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        supportsImage: false,
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        sourceUrl: OfficialModelCatalogSourceUrl.DeepSeek,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        supportsImage: false,
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        sourceUrl: OfficialModelCatalogSourceUrl.DeepSeek,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        supportsImage: false,
      },
    ],
  },
  {
    id: ProviderName.Moonshot,
    label: 'Moonshot',
    website: 'https://platform.moonshot.cn',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    agentProviderId: AgentProviderId.Moonshot,
    // Moonshot's /anthropic endpoint does not fully implement the Anthropic Messages spec
    // (no tool use, incomplete streaming, etc.). API connectivity tests pass, but actual
    // cowork sessions fail to send/receive messages. Force OpenAI-compatible format instead.
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultApiFormat: ApiFormat.OpenAI,
    codingPlanSupported: true,
    codingPlanUrls: {
      openai: 'https://api.kimi.com/coding/v1',
      anthropic: 'https://api.kimi.com/coding',
    },
    preferredCodingPlanFormat: 'anthropic',
    switchableBaseUrls: {
      anthropic: 'https://api.moonshot.cn/anthropic',
      openai: 'https://api.moonshot.cn/v1',
    },
    region: 'china',
    enPriority: 0,
    defaultModels: [
      {
        id: 'kimi-k3',
        name: 'Kimi K3',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 131_072,
        sourceUrl: OfficialModelCatalogSourceUrl.MoonshotK3,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'kimi-k2.6',
        name: 'Kimi K2.6',
        supportsImage: true,
        contextWindow: 256_000,
        sourceUrl: OfficialModelCatalogSourceUrl.MoonshotK26,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        supportsImage: true,
        contextWindow: 256_000,
        sourceUrl: OfficialModelCatalogSourceUrl.MoonshotK26,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
    ],
    codingPlanModels: [
      {
        id: 'kimi-for-coding',
        name: 'Kimi for Coding',
        supportsImage: true,
        contextWindow: 262_144,
        maxTokens: 32_768,
        // The Kimi for Coding endpoints (api.kimi.com/coding) support tool
        // calling in both API formats — unlike the general Moonshot
        // /anthropic endpoint this provider maps to Unsupported below.
        capabilities: { toolCalling: ModelCapabilityStatus.Supported },
      },
    ],
  },
  {
    id: ProviderName.Qwen,
    label: 'Qwen',
    website: 'https://dashscope.console.aliyun.com',
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    agentProviderId: AgentProviderId.Qwen,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
    defaultApiFormat: ApiFormat.Anthropic,
    codingPlanSupported: true,
    codingPlanUrls: {
      openai: 'https://coding.dashscope.aliyuncs.com/v1',
      anthropic: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    },
    preferredCodingPlanFormat: 'openai',
    switchableBaseUrls: {
      anthropic: 'https://dashscope.aliyuncs.com/apps/anthropic',
      openai: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    region: 'china',
    enPriority: 0,
    defaultModels: [
      {
        id: 'qwen3.7-max',
        name: 'Qwen3.7 Max',
        supportsImage: false,
        contextWindow: 1_000_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Qwen,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'qwen3.7-plus',
        name: 'Qwen3.7 Plus',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 64_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Qwen,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'qwen3.6-plus',
        name: 'Qwen3.6 Plus',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 64_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Qwen,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'qwen3.5-plus',
        name: 'Qwen3.5 Plus',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 64_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Qwen,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'qwen3-coder-plus',
        name: 'Qwen3 Coder Plus',
        supportsImage: false,
        contextWindow: 1_000_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Qwen,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
    ],
    codingPlanModels: [
      {
        id: 'qwen3.7-plus',
        name: 'Qwen3.7 Plus',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 64_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Qwen,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'qwen3.6-plus',
        name: 'Qwen3.6 Plus',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 64_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Qwen,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'qwen3-coder-next',
        name: 'Qwen3 Coder Next',
        supportsImage: false,
        contextWindow: 256_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Qwen,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'qwen3-coder-plus',
        name: 'Qwen3 Coder Plus',
        supportsImage: false,
        contextWindow: 1_000_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Qwen,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
    ],
  },
  {
    id: ProviderName.Zhipu,
    label: 'Zhipu',
    website: 'https://open.bigmodel.cn',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    agentProviderId: AgentProviderId.Zai,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
    defaultApiFormat: ApiFormat.Anthropic,
    codingPlanSupported: true,
    codingPlanUrls: {
      openai: 'https://open.bigmodel.cn/api/coding/paas/v4',
      anthropic: 'https://open.bigmodel.cn/api/anthropic',
    },
    preferredCodingPlanFormat: 'openai',
    switchableBaseUrls: {
      anthropic: 'https://open.bigmodel.cn/api/anthropic',
      openai: 'https://open.bigmodel.cn/api/paas/v4',
    },
    region: 'china',
    enPriority: 0,
    defaultModels: [
      {
        id: 'glm-5.2',
        name: 'GLM 5.2',
        supportsImage: false,
        contextWindow: 1_000_000,
        maxTokens: 131_072,
        sourceUrl: OfficialModelCatalogSourceUrl.Zhipu,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'glm-5',
        name: 'GLM 5',
        supportsImage: false,
        contextWindow: 200_000,
        maxTokens: 131_072,
        sourceUrl: OfficialModelCatalogSourceUrl.Zhipu,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'glm-4.7',
        name: 'GLM 4.7',
        supportsImage: false,
        contextWindow: 200_000,
        maxTokens: 131_072,
        sourceUrl: OfficialModelCatalogSourceUrl.Zhipu,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
    ],
    codingPlanModels: [
      {
        id: 'glm-5.2',
        name: 'GLM 5.2',
        supportsImage: false,
        contextWindow: 1_000_000,
        maxTokens: 131_072,
        sourceUrl: OfficialModelCatalogSourceUrl.Zhipu,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'glm-5-turbo',
        name: 'GLM 5 Turbo',
        supportsImage: false,
        contextWindow: 200_000,
        maxTokens: 131_072,
        sourceUrl: OfficialModelCatalogSourceUrl.Zhipu,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'glm-4.7',
        name: 'GLM 4.7',
        supportsImage: false,
        contextWindow: 200_000,
        maxTokens: 131_072,
        sourceUrl: OfficialModelCatalogSourceUrl.Zhipu,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
    ],
  },
  {
    id: ProviderName.Minimax,
    label: 'MiniMax',
    website: 'https://platform.minimaxi.com',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    agentProviderId: AgentProviderId.Minimax,
    defaultBaseUrl: 'https://api.minimaxi.com/anthropic',
    defaultApiFormat: ApiFormat.Anthropic,
    codingPlanSupported: false,
    switchableBaseUrls: {
      anthropic: 'https://api.minimaxi.com/anthropic',
      openai: 'https://api.minimaxi.com/v1',
    },
    region: 'china',
    enPriority: 0,
    defaultModels: [
      {
        id: 'MiniMax-M3',
        name: 'MiniMax M3',
        supportsImage: true,
        contextWindow: 1_000_000,
        sourceUrl: OfficialModelCatalogSourceUrl.MiniMax,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'MiniMax-M2.7',
        name: 'MiniMax M2.7',
        supportsImage: false,
        contextWindow: 204_800,
        sourceUrl: OfficialModelCatalogSourceUrl.MiniMax,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'MiniMax-M2.5',
        name: 'MiniMax M2.5',
        supportsImage: false,
        contextWindow: 204_800,
        sourceUrl: OfficialModelCatalogSourceUrl.MiniMax,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
    ],
  },
  {
    id: ProviderName.Volcengine,
    label: 'Volcengine',
    website: 'https://console.volcengine.com/ark',
    apiKeyUrl: 'https://console.volcengine.com/ark',
    agentProviderId: AgentProviderId.Volcengine,
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/compatible',
    defaultApiFormat: ApiFormat.Anthropic,
    codingPlanSupported: true,
    codingPlanUrls: {
      openai: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      anthropic: 'https://ark.cn-beijing.volces.com/api/coding',
    },
    switchableBaseUrls: {
      anthropic: 'https://ark.cn-beijing.volces.com/api/compatible',
      openai: 'https://ark.cn-beijing.volces.com/api/v3',
    },
    region: 'china',
    enPriority: 0,
    defaultModels: [
      {
        id: 'doubao-seed-2-0-pro-260215',
        name: 'Doubao-Seed-2.0-pro',
        supportsImage: true,
        contextWindow: 256_000,
        maxTokens: 128_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Volcengine,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      { id: 'ark-code-latest', name: 'Auto', supportsImage: true },
      {
        id: 'doubao-seed-2-0-lite-260215',
        name: 'Doubao-Seed-2.0-lite',
        supportsImage: true,
        contextWindow: 256_000,
        maxTokens: 128_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Volcengine,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'doubao-seed-2-0-mini-260215',
        name: 'Doubao-Seed-2.0-mini',
        supportsImage: true,
        contextWindow: 256_000,
        maxTokens: 128_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Volcengine,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
    ],
    codingPlanModels: [{ id: 'ark-code-latest', name: 'Ark Coding', supportsImage: false }],
  },
  {
    id: ProviderName.Qianfan,
    label: 'Qianfan',
    apiKeyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/apiKey',
    agentProviderId: AgentProviderId.Qianfan,
    defaultBaseUrl: 'https://qianfan.baidubce.com/v2',
    defaultApiFormat: ApiFormat.OpenAI,
    codingPlanSupported: true,
    codingPlanUrls: {
      openai: 'https://qianfan.baidubce.com/v2/coding/chat/completions',
    },
    preferredCodingPlanFormat: 'openai',
    region: 'china',
    enPriority: 0,
    defaultModels: [
      { id: 'deepseek-v3.2', name: 'DeepSeek V3.2', supportsImage: false },
      { id: 'deepseek-r1', name: 'DeepSeek R1', supportsImage: false },
      {
        id: 'ernie-4.5-8k',
        name: 'ERNIE 4.5 8K',
        supportsImage: false,
      },
      {
        id: 'ernie-4.5-turbo-8k',
        name: 'ERNIE 4.5 Turbo',
        supportsImage: false,
      },
    ],
    codingPlanModels: [
      { id: 'qianfan-code-latest', name: 'Qianfan Coding', supportsImage: false },
      { id: 'glm-5.1', name: 'GLM 5.1', supportsImage: false },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', supportsImage: false },
    ],
  },
  {
    id: ProviderName.StepFun,
    label: 'StepFun',
    website: 'https://platform.stepfun.com',
    apiKeyUrl: 'https://platform.stepfun.com/interface-key',
    agentProviderId: AgentProviderId.StepFun,
    defaultBaseUrl: 'https://api.stepfun.com/v1',
    defaultApiFormat: ApiFormat.OpenAI,
    codingPlanSupported: false,
    region: 'china',
    enPriority: 0,
    defaultModels: [
      {
        id: 'step-3.7-flash',
        name: 'Step 3.7 Flash',
        supportsImage: true,
        contextWindow: 256_000,
        sourceUrl: OfficialModelCatalogSourceUrl.StepFun,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'step-3.5-flash',
        name: 'Step 3.5 Flash',
        supportsImage: false,
        contextWindow: 256_000,
        sourceUrl: OfficialModelCatalogSourceUrl.StepFun,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
    ],
  },
  {
    id: ProviderName.Xiaomi,
    label: 'Xiaomi',
    website: 'https://dev.mi.com/platform',
    apiKeyUrl: 'https://dev.mi.com/platform',
    agentProviderId: AgentProviderId.Xiaomi,
    defaultBaseUrl: 'https://api.xiaomimimo.com/anthropic',
    defaultApiFormat: ApiFormat.Anthropic,
    codingPlanSupported: true,
    codingPlanUrls: {
      openai: 'https://token-plan-cn.xiaomimimo.com/v1',
      anthropic: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    },
    switchableBaseUrls: {
      anthropic: 'https://api.xiaomimimo.com/anthropic',
      openai: 'https://api.xiaomimimo.com/v1/chat/completions',
    },
    region: 'china',
    enPriority: 0,
    defaultModels: [
      {
        id: 'mimo-v2.5-pro-ultraspeed',
        name: 'MiMo V2.5 Pro Ultraspeed',
        supportsImage: false,
      },
      {
        id: 'mimo-v2.5-pro',
        name: 'MiMo V2.5 Pro',
        supportsImage: false,
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Xiaomi,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'mimo-v2.5',
        name: 'MiMo V2.5',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Xiaomi,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'mimo-v2-pro',
        name: 'MiMo V2 Pro',
        supportsImage: false,
      },
      {
        id: 'mimo-v2-flash',
        name: 'MiMo V2 Flash',
        supportsImage: false,
      },
    ],
    codingPlanModels: [
      {
        id: 'mimo-v2.5-pro',
        name: 'MiMo V2.5 Pro',
        supportsImage: false,
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Xiaomi,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'mimo-v2.5',
        name: 'MiMo V2.5',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        sourceUrl: OfficialModelCatalogSourceUrl.Xiaomi,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
    ],
  },
  {
    id: ProviderName.Ollama,
    label: 'Ollama',
    website: 'https://ollama.com',
    agentProviderId: AgentProviderId.Ollama,
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultApiFormat: ApiFormat.OpenAI,
    codingPlanSupported: false,
    switchableBaseUrls: {
      anthropic: 'http://localhost:11434',
      openai: 'http://localhost:11434/v1',
    },
    region: 'china',
    enPriority: 0,
    defaultModels: [],
  },
  {
    id: ProviderName.LlamaCpp,
    label: '本地模型',
    website: 'https://github.com/ggerganov/llama.cpp',
    agentProviderId: AgentProviderId.LlamaCpp,
    defaultBaseUrl: 'http://127.0.0.1:8080/v1',
    defaultApiFormat: ApiFormat.OpenAI,
    codingPlanSupported: false,
    switchableBaseUrls: {
      anthropic: 'http://127.0.0.1:8080',
      openai: 'http://127.0.0.1:8080/v1',
    },
    region: 'china',
    enPriority: 0,
    defaultModels: [],
  },
  // ── Global ──
  {
    id: ProviderName.Copilot,
    label: 'GitHub Copilot',
    agentProviderId: AgentProviderId.ZhiyuanCopilot,
    defaultBaseUrl: 'https://api.individual.githubcopilot.com',
    defaultApiFormat: ApiFormat.OpenAI,
    codingPlanSupported: false,
    region: 'global',
    enPriority: 0,
    defaultModels: [
      {
        id: 'gpt-5-mini',
        name: 'GPT-5 mini',
        supportsImage: true,
        contextWindow: 264_000,
        maxTokens: 64_000,
      },
      {
        id: 'claude-haiku-4.5',
        name: 'Claude Haiku 4.5',
        supportsImage: true,
        contextWindow: 200_000,
        maxTokens: 64_000,
      },
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        supportsImage: true,
        contextWindow: 128_000,
        maxTokens: 16_384,
      },
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        supportsImage: true,
        contextWindow: 1_050_000,
        maxTokens: 128_000,
      },
    ],
  },
  {
    id: ProviderName.Grok,
    label: 'Grok',
    website: 'https://x.ai',
    apiKeyUrl: 'https://console.x.ai',
    agentProviderId: AgentProviderId.Grok,
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultApiFormat: ApiFormat.OpenAI,
    codingPlanSupported: false,
    region: 'global',
    enPriority: 4,
    defaultModels: [
      {
        id: 'grok-4.5',
        name: 'Grok 4.5',
        supportsImage: true,
        capabilities: {
          toolCalling: ModelCapabilityStatus.Supported,
          reasoning: ModelCapabilityStatus.Supported,
        },
        contextWindow: 500_000,
        sourceUrl: 'https://docs.x.ai/developers/models',
        verifiedAt: '2026-08-03',
      },
    ],
  },
  {
    id: ProviderName.OpenAI,
    label: 'OpenAI',
    website: 'https://platform.openai.com',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    agentProviderId: AgentProviderId.OpenAI,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultApiFormat: ApiFormat.OpenAI,
    codingPlanSupported: false,
    region: 'global',
    enPriority: 1,
    defaultModels: [
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        supportsImage: true,
        aliases: ['gpt-5.6'],
        capabilities: {
          toolCalling: ModelCapabilityStatus.Supported,
          reasoning: ModelCapabilityStatus.Supported,
        },
        contextWindow: 1_050_000,
        maxTokens: 128_000,
        sourceUrl: OfficialModelCatalogSourceUrl.OpenAI,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'gpt-5.6-terra',
        name: 'GPT-5.6 Terra',
        supportsImage: true,
        capabilities: {
          toolCalling: ModelCapabilityStatus.Supported,
          reasoning: ModelCapabilityStatus.Supported,
        },
        contextWindow: 1_050_000,
        maxTokens: 128_000,
        sourceUrl: OfficialModelCatalogSourceUrl.OpenAI,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        supportsImage: true,
        capabilities: {
          toolCalling: ModelCapabilityStatus.Supported,
          reasoning: ModelCapabilityStatus.Supported,
        },
        contextWindow: 1_050_000,
        maxTokens: 128_000,
        sourceUrl: OfficialModelCatalogSourceUrl.OpenAI,
        verifiedAt: MODEL_CATALOG_VERIFIED_AT,
      },
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        supportsImage: true,
        contextWindow: 1_050_000,
        maxTokens: 128_000,
      },
      {
        id: 'gpt-5.2',
        name: 'GPT-5.2',
        supportsImage: true,
        contextWindow: 400_000,
        maxTokens: 128_000,
      },
      {
        id: 'gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        supportsImage: true,
        contextWindow: 400_000,
        maxTokens: 128_000,
      },
      {
        id: 'gpt-5.2-codex',
        name: 'GPT-5.2 Codex',
        supportsImage: true,
        contextWindow: 400_000,
        maxTokens: 128_000,
      },
    ],
  },
  {
    id: ProviderName.Gemini,
    label: 'Gemini',
    website: 'https://aistudio.google.com',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    agentProviderId: AgentProviderId.Google,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultApiFormat: ApiFormat.Gemini,
    codingPlanSupported: false,
    region: 'global',
    enPriority: 3,
    defaultModels: [
      {
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro',
        supportsImage: true,
        contextWindow: 1_048_576,
        maxTokens: 65_536,
      },
      {
        id: 'gemini-3.1-pro-preview',
        name: 'Gemini 3.1 Pro',
        supportsImage: true,
        contextWindow: 1_048_576,
        maxTokens: 65_536,
      },
      {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        supportsImage: true,
        contextWindow: 1_048_576,
        maxTokens: 65_536,
      },
    ],
  },
  {
    id: ProviderName.Anthropic,
    label: 'Anthropic',
    website: 'https://console.anthropic.com',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    agentProviderId: AgentProviderId.Anthropic,
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultApiFormat: ApiFormat.Anthropic,
    codingPlanSupported: false,
    region: 'global',
    enPriority: 2,
    defaultModels: [
      {
        id: 'claude-sonnet-4-5-20250929',
        name: 'Claude Sonnet 4.5',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 64_000,
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 128_000,
      },
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 128_000,
      },
    ],
  },
  {
    id: ProviderName.OpenRouter,
    label: 'OpenRouter',
    website: 'https://openrouter.ai',
    apiKeyUrl: 'https://openrouter.ai/keys',
    agentProviderId: AgentProviderId.OpenRouter,
    defaultBaseUrl: 'https://openrouter.ai/api',
    defaultApiFormat: ApiFormat.Anthropic,
    codingPlanSupported: false,
    switchableBaseUrls: {
      anthropic: 'https://openrouter.ai/api',
      openai: 'https://openrouter.ai/api/v1',
    },
    region: 'global',
    enPriority: 0,
    defaultModels: [
      {
        id: 'anthropic/claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 64_000,
      },
      {
        id: 'anthropic/claude-opus-4.6',
        name: 'Claude Opus 4.6',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 128_000,
      },
      {
        id: 'openai/gpt-5.2-codex',
        name: 'GPT 5.2 Codex',
        supportsImage: true,
        contextWindow: 400_000,
        maxTokens: 128_000,
      },
      {
        id: 'google/gemini-3-pro-preview',
        name: 'Gemini 3 Pro',
        supportsImage: true,
        contextWindow: 1_048_576,
        maxTokens: 65_536,
      },
    ],
  },
] as const satisfies readonly ProviderDefInput[];

// ═══════════════════════════════════════════════════════
// 4. Provider Definition Interface (public)
// ═══════════════════════════════════════════════════════

export interface ProviderDef {
  /** Provider identifier (e.g. 'openai', 'moonshot') */
  readonly id: string;
  /** Human-readable display name shown in UI */
  readonly label: string;
  /** Provider console / product website URL */
  readonly website?: string;
  /** API key creation page URL */
  readonly apiKeyUrl?: string;
  /** Default base URL */
  readonly defaultBaseUrl: string;
  /** Default API format */
  readonly defaultApiFormat: ApiFormat;
  /** Whether this provider supports codingPlan mode */
  readonly codingPlanSupported: boolean;
  /** Coding Plan dedicated endpoints */
  readonly codingPlanUrls?: {
    readonly openai?: string;
    readonly anthropic?: string;
  };
  /** When set, overrides caller's apiFormat for coding plan URL resolution. */
  readonly preferredCodingPlanFormat?: 'openai' | 'anthropic';
  /** Default baseUrl per apiFormat for UI switching */
  readonly switchableBaseUrls?: {
    readonly anthropic: string;
    readonly openai: string;
  };
  /** Region grouping for UI visibility */
  readonly region: 'china' | 'global';
  /** Priority ordering for English locale display (lower = higher priority, 0 = no special priority) */
  readonly enPriority: number;
  /** Default model list */
  readonly defaultModels: readonly ProviderModelDefinition[];
  readonly codingPlanModels?: readonly ProviderModelDefinition[];
  readonly agentProviderId: AgentProviderId;
}

// ═══════════════════════════════════════════════════════
// 5. Registry Implementation
// ═══════════════════════════════════════════════════════

/**
 * Tool support verified for the provider protocol used by catalog models.
 *
 * This is deliberately not a provider-wide fallback for arbitrary model IDs:
 * accepting an endpoint protocol does not prove that every model routed through
 * that endpoint can emit tool calls. Unknown/custom models must stay Unknown
 * unless they carry explicit metadata or a runtime probe confirms support.
 */
const CATALOG_PROVIDER_TOOL_CAPABILITIES: Readonly<
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
const CATALOG_TOOL_CALLING_MODEL_IDS: Readonly<Record<string, readonly string[]>> = {
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
const CATALOG_MODEL_CAPABILITIES: Readonly<
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

class ProviderRegistryImpl {
  private readonly defs: readonly ProviderDef[];
  private readonly idIndex: ReadonlyMap<string, ProviderDef>;
  private readonly modelIndex: ProviderModelIndex;

  constructor(definitions: readonly ProviderDef[]) {
    this.defs = definitions;
    const idx = new Map<string, ProviderDef>();
    for (const def of definitions) {
      idx.set(def.id, def);
    }
    this.idIndex = idx;
    this.modelIndex = buildProviderModelIndex(definitions);
  }

  /** All provider IDs in definition order. */
  get providerIds(): readonly string[] {
    return this.defs.map(d => d.id);
  }

  /** Get full definition for a provider. Returns undefined for unknown IDs. */
  get(id: string): ProviderDef | undefined {
    return this.idIndex.get(id);
  }

  /** Whether a provider supports codingPlan. */
  supportsCodingPlan(id: string): boolean {
    return this.idIndex.get(id)?.codingPlanSupported ?? false;
  }

  /** Providers filtered by region, preserving definition order. */
  byRegion(region: 'china' | 'global'): readonly ProviderDef[] {
    return this.defs.filter(d => d.region === region);
  }

  getCodingPlanUrl(id: string, format: 'openai' | 'anthropic'): string | undefined {
    const def = this.idIndex.get(id);
    if (!def?.codingPlanSupported || !def.codingPlanUrls) return undefined;
    return def.codingPlanUrls[format];
  }

  getSwitchableBaseUrl(id: string, format: 'openai' | 'anthropic'): string | undefined {
    return this.idIndex.get(id)?.switchableBaseUrls?.[format];
  }

  getAgentProviderId(providerName: string): string {
    return (
      this.idIndex.get(providerName)?.agentProviderId ??
      providerName ??
      AgentProviderId.Zhiyuan
    );
  }

  /** Resolve a runtime provider ID back to its application configuration key. */
  getProviderNameByAgentProviderId(agentProviderId: string): string | undefined {
    return this.defs.find(def => def.agentProviderId === agentProviderId)?.id;
  }

  getProviderModelSupportsImage(providerName: string, modelId: string): boolean | undefined {
    const model = this.getModel(providerName, modelId);
    return model?.supportsImage;
  }

  /**
   * Return all provider-owned entries matching a canonical ID or alias.
   * Matching is case-insensitive, but the returned model keeps its canonical ID.
   */
  getModels(providerName: string, modelId: string | undefined): readonly ProviderModelDefinition[] {
    return getIndexedProviderModels(this.modelIndex, providerName, modelId);
  }

  /** Find the first provider-owned catalog entry; IDs are never matched globally. */
  getModel(providerName: string, modelId: string | undefined): ProviderModelDefinition | undefined {
    return this.getModels(providerName, modelId)[0];
  }

  /** Find every catalog owner of a model ID; callers must keep the provider pair. */
  findModelsById(
    modelId: string | undefined,
  ): Array<{ providerId: string; model: ProviderModelDefinition }> {
    if (typeof modelId !== 'string' || !modelId.trim()) return [];
    const matches: Array<{ providerId: string; model: ProviderModelDefinition }> = [];
    for (const def of this.defs) {
      const model = this.getModel(def.id, modelId);
      if (model) matches.push({ providerId: def.id, model });
    }
    return matches;
  }

  resolveModelCapabilities(
    providerName: string,
    modelId: string,
    apiFormat: ApiFormat,
    configured?: {
      readonly supportsImage?: boolean;
      readonly capabilities?: Partial<ModelCapabilities>;
    },
  ): ModelCapabilities {
    const providerModels = this.getModels(providerName, modelId);
    const providerModel =
      providerModels.find(
        candidate =>
          configured?.supportsImage !== undefined &&
          candidate.supportsImage === configured.supportsImage,
      ) ?? providerModels[0];
    const isCatalogModel = providerModel !== undefined;
    const catalogModelId = providerModel?.id ?? modelId;
    const catalogCapabilities = CATALOG_MODEL_CAPABILITIES[providerName]?.[catalogModelId];
    const hasVerifiedCatalogToolCalling =
      CATALOG_TOOL_CALLING_MODEL_IDS[providerName]?.includes(catalogModelId) === true;
    const endpointToolCalling = CATALOG_PROVIDER_TOOL_CAPABILITIES[providerName]?.[apiFormat];
    const configuredCapabilities = isCatalogModel ? undefined : configured?.capabilities;
    const imageSupport = this.resolveModelSupportsImage(
      providerName,
      modelId,
      configured?.supportsImage,
    );
    // Same residue rule as toolCalling: an explicit configured
    // supported/unsupported is user intent and wins; "unknown" is the
    // default residue of the capability form and must fall through.
    // Falling through lands on the toggle only when it is positively
    // checked — Settings always writes a supportsImage boolean, so a
    // derived false must not turn an unstated "unknown" into
    // "unsupported" (it would lose the three-state capability selector's
    // unknown state on reload).
    const declaredImageCapability =
      (providerModel?.capabilities?.imageInput === ModelCapabilityStatus.Supported ||
      providerModel?.capabilities?.imageInput === ModelCapabilityStatus.Unsupported
        ? providerModel?.capabilities?.imageInput
        : undefined) ??
      (configuredCapabilities?.imageInput === ModelCapabilityStatus.Supported ||
      configuredCapabilities?.imageInput === ModelCapabilityStatus.Unsupported
        ? configuredCapabilities?.imageInput
        : undefined);
    const imageCapability =
      declaredImageCapability ??
      (isCatalogModel
        ? // Catalog declarations are authoritative even against a stale
          // configured toggle (resolveModelSupportsImage repairs known
          // provider metadata); only user-added models fall back to the
          // positively checked toggle.
          imageSupport
          ? ModelCapabilityStatus.Supported
          : ModelCapabilityStatus.Unsupported
        : configured?.supportsImage === true
          ? ModelCapabilityStatus.Supported
          : ModelCapabilityStatus.Unknown);
    return {
      ...UNKNOWN_MODEL_CAPABILITIES,
      ...catalogCapabilities,
      ...providerModel?.capabilities,
      ...configuredCapabilities,
      imageInput: imageCapability,
      toolCalling:
        catalogCapabilities?.toolCalling ??
        providerModel?.capabilities?.toolCalling ??
        (endpointToolCalling === ModelCapabilityStatus.Unsupported
          ? ModelCapabilityStatus.Unsupported
          : undefined) ??
        // An explicit configured supported/unsupported is user intent and
        // wins. An explicit "unknown" is not a verdict — it is the default
        // residue of the capability form (DEFAULT_CUSTOM_MODEL_CAPABILITIES),
        // so it must not short-circuit the endpoint declaration below.
        (configuredCapabilities?.toolCalling === ModelCapabilityStatus.Supported ||
        configuredCapabilities?.toolCalling === ModelCapabilityStatus.Unsupported
          ? configuredCapabilities.toolCalling
          : undefined) ??
        // Catalog models keep their evidence requirement — an endpoint
        // accepting `tools` does not prove every model can emit tool calls.
        // User-added models outside the catalog have no catalog evidence at
        // all, so the endpoint declaration is the only reasonable default
        // (this restores the pre-#314 behavior: unknown user models trusted
        // the endpoint).
        (isCatalogModel
          ? hasVerifiedCatalogToolCalling
            ? endpointToolCalling
            : undefined
          : endpointToolCalling) ??
        ModelCapabilityStatus.Unknown,
    };
  }

  resolveModelSupportsImage(
    providerName: string,
    modelId: string,
    configuredSupportsImage?: boolean,
  ): boolean {
    const providerModels = this.getModels(providerName, modelId);
    if (
      providerModels.length > 1 &&
      new Set(providerModels.map(candidate => candidate.supportsImage)).size > 1 &&
      configuredSupportsImage !== undefined
    ) {
      return configuredSupportsImage;
    }
    if (providerModels.length > 0) {
      return providerModels[0].supportsImage;
    }

    // A bare model ID is not a capability proof across providers. Preserve the
    // provider-specific explicit value and otherwise stay conservatively false.
    return configuredSupportsImage ?? false;
  }

  /** Provider IDs filtered by region. */
  idsByRegion(region: 'china' | 'global'): readonly string[] {
    return this.defs.filter(d => d.region === region).map(d => d.id);
  }

  /**
   * Provider IDs for English locale display:
   * EN_PRIORITY providers first (sorted by enPriority), then CHINA, then remaining GLOBAL.
   * local providers are always pushed to the end, with Ollama last.
   */
  idsForEnLocale(): readonly string[] {
    const priority = this.defs
      .filter(d => d.enPriority > 0)
      .sort((a, b) => a.enPriority - b.enPriority)
      .map(d => d.id);
    const china = this.idsByRegion('china');
    const global = this.idsByRegion('global');

    const orderedProviders = [...priority, ...china, ...global];
    const unique = [...new Set(orderedProviders)];

    // Move local providers to the end.
    for (const localProvider of [ProviderName.LlamaCpp, ProviderName.Ollama]) {
      const idx = unique.indexOf(localProvider);
      if (idx !== -1) {
        unique.splice(idx, 1);
      }
    }
    unique.push(ProviderName.LlamaCpp);
    unique.push(ProviderName.Ollama);
    return unique;
  }
}

export const ProviderRegistry = new ProviderRegistryImpl(PROVIDER_DEFINITIONS);
