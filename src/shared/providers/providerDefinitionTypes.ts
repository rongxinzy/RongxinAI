/**
 * Provider definition shapes and shared catalog metadata.
 *
 * `ProviderModelDefinition` describes a provider-owned catalog entry,
 * `ProviderDefInput` is the shape every provider record must satisfy, and
 * `ProviderDef` is the public read-only view served by the registry.
 * `MODEL_CATALOG_VERIFIED_AT` and `OfficialModelCatalogSourceUrl` document
 * where catalog capacity numbers were last verified.
 */

import type { AgentProviderId, ApiFormat, ModelCapabilities } from './providerIdentities';

export const MODEL_CATALOG_VERIFIED_AT = '2026-08-03';

export const OfficialModelCatalogSourceUrl = {
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

export interface ProviderDefInput {
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
