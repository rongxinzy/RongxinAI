import { ModelCapabilityStatus, type ModelCapabilities } from './constants';

export const ProviderModelPiApi = {
  AnthropicMessages: 'anthropic-messages',
  OpenAICompletions: 'openai-completions',
  OpenAIResponses: 'openai-responses',
} as const;
export type ProviderModelPiApi = (typeof ProviderModelPiApi)[keyof typeof ProviderModelPiApi];

export const ProviderModelPiMaxTokensField = {
  MaxCompletionTokens: 'max_completion_tokens',
  MaxTokens: 'max_tokens',
} as const;
export type ProviderModelPiMaxTokensField =
  (typeof ProviderModelPiMaxTokensField)[keyof typeof ProviderModelPiMaxTokensField];

export const ProviderModelPiThinkingFormat = {
  OpenAI: 'openai',
  OpenRouter: 'openrouter',
  DeepSeek: 'deepseek',
  Together: 'together',
  Baseten: 'baseten',
  Zai: 'zai',
  Qwen: 'qwen',
  ChatTemplate: 'chat-template',
  QwenChatTemplate: 'qwen-chat-template',
  StringThinking: 'string-thinking',
  AntLing: 'ant-ling',
} as const;
export type ProviderModelPiThinkingFormat =
  (typeof ProviderModelPiThinkingFormat)[keyof typeof ProviderModelPiThinkingFormat];

export const ProviderModelPiThinkingBudgetField = {
  Vllm: 'thinking_token_budget',
  QwenSglang: 'thinking_budget',
  LlamaCpp: 'thinking_budget_tokens',
} as const;
export type ProviderModelPiThinkingBudgetField =
  (typeof ProviderModelPiThinkingBudgetField)[keyof typeof ProviderModelPiThinkingBudgetField];

export const ProviderModelPiSessionAffinityFormat = {
  OpenAI: 'openai',
  OpenAINoSession: 'openai-nosession',
  OpenRouter: 'openrouter',
} as const;
export type ProviderModelPiSessionAffinityFormat =
  (typeof ProviderModelPiSessionAffinityFormat)[keyof typeof ProviderModelPiSessionAffinityFormat];

export type ProviderModelPiThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';
export type ProviderModelPiThinkingLevelMap = Partial<
  Record<ProviderModelPiThinkingLevel, string | null>
>;

export const ProviderModelPiCacheControlFormat = {
  Anthropic: 'anthropic',
} as const;
export type ProviderModelPiCacheControlFormat =
  (typeof ProviderModelPiCacheControlFormat)[keyof typeof ProviderModelPiCacheControlFormat];

export interface ProviderModelPiRuntimeCompat {
  readonly supportsDeveloperRole?: boolean;
  readonly supportsReasoningEffort?: boolean;
  readonly supportsUsageInStreaming?: boolean;
  readonly supportsStrictMode?: boolean;
  readonly supportsFinishReason?: boolean;
  readonly supportsStore?: boolean;
  readonly maxTokensField?: ProviderModelPiMaxTokensField;
  readonly requiresToolResultName?: boolean;
  readonly requiresAssistantAfterToolResult?: boolean;
  readonly requiresThinkingAsText?: boolean;
  readonly requiresReasoningContentOnAssistantMessages?: boolean;
  readonly thinkingFormat?: ProviderModelPiThinkingFormat;
  readonly chatTemplateKwargs?: Record<string, string>;
  readonly chatTemplateArgs?: Record<string, string>;
  readonly thinkingTokenBudgetField?: ProviderModelPiThinkingBudgetField;
  readonly supportsThinkingTokenBudget?: boolean;
  readonly supportsOpenAIGrammarTools?: boolean;
  readonly supportsMidConvoSystemMessages?: boolean;
  readonly supportsMidConvoToolAdditions?: boolean;
  readonly sendSessionAffinityHeaders?: boolean;
  readonly sessionAffinityFormat?: ProviderModelPiSessionAffinityFormat;
  readonly supportsLongCacheRetention?: boolean;
  readonly vllmPriority?: number;
  readonly zaiToolStream?: boolean;
  readonly cacheControlFormat?: ProviderModelPiCacheControlFormat;
}

/** Cache-safe image preprocessing profile (pi-ai ModelImageResizeOptions). */
export interface ProviderModelPiImageResize {
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly maxBytes?: number;
  readonly jpegQuality?: number;
}

/** Per-model provider input limits (pi-ai ModelInputLimits). */
export interface ProviderModelPiInputLimits {
  readonly maxRequestBytes?: number;
  readonly images?: {
    readonly resize?: ProviderModelPiImageResize;
    readonly maxPerMessage?: number;
    readonly maxPerRequest?: number;
  };
}

/** Per-model compaction budgets; unset fields fall back to the session defaults. */
export interface ProviderModelPiCompaction {
  readonly reserveTokens?: number;
  readonly keepRecentTokens?: number;
}

export interface ProviderModelPiRuntimeConfig {
  readonly api?: ProviderModelPiApi;
  readonly reasoning?: boolean;
  readonly thinkingLevelMap?: ProviderModelPiThinkingLevelMap;
  readonly compat?: ProviderModelPiRuntimeCompat;
  readonly inputLimits?: ProviderModelPiInputLimits;
  readonly compaction?: ProviderModelPiCompaction;
  readonly promptCache?: Record<string, unknown>;
  readonly samplingParams?: Record<string, unknown>;
}

const PI_API_VALUES = new Set<string>(Object.values(ProviderModelPiApi));
const MAX_TOKENS_FIELD_VALUES = new Set<string>(Object.values(ProviderModelPiMaxTokensField));
const THINKING_FORMAT_VALUES = new Set<string>(Object.values(ProviderModelPiThinkingFormat));
const THINKING_BUDGET_FIELD_VALUES = new Set<string>(
  Object.values(ProviderModelPiThinkingBudgetField),
);
const SESSION_AFFINITY_FORMAT_VALUES = new Set<string>(
  Object.values(ProviderModelPiSessionAffinityFormat),
);
const CACHE_CONTROL_FORMAT_VALUES = new Set<string>(
  Object.values(ProviderModelPiCacheControlFormat),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Keeps non-empty string entries (chat-template kwarg templates are strings). */
function optionalStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim() !== '') out[key] = entry;
  }
  return hasKeys(out) ? out : undefined;
}

function optionalEnum<T extends string>(
  value: unknown,
  values: ReadonlySet<string>,
): T | undefined {
  return typeof value === 'string' && values.has(value) ? (value as T) : undefined;
}

function hasKeys(value: object): boolean {
  return Object.keys(value).length > 0;
}

function normalizeThinkingLevelMap(value: unknown): ProviderModelPiThinkingLevelMap | undefined {
  if (!isRecord(value)) return undefined;
  const normalized: ProviderModelPiThinkingLevelMap = {};
  for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
    const mapped = value[level];
    if (mapped === null) {
      normalized[level] = null;
    } else if (typeof mapped === 'string' && mapped.trim() !== '') {
      normalized[level] = mapped;
    }
  }
  return hasKeys(normalized) ? normalized : undefined;
}

function normalizeImageResize(value: unknown): ProviderModelPiImageResize | undefined {
  if (!isRecord(value)) return undefined;
  const normalized: ProviderModelPiImageResize = {
    ...(optionalNumber(value.maxWidth) !== undefined
      ? { maxWidth: optionalNumber(value.maxWidth) }
      : {}),
    ...(optionalNumber(value.maxHeight) !== undefined
      ? { maxHeight: optionalNumber(value.maxHeight) }
      : {}),
    ...(optionalNumber(value.maxBytes) !== undefined
      ? { maxBytes: optionalNumber(value.maxBytes) }
      : {}),
    ...(optionalNumber(value.jpegQuality) !== undefined
      ? { jpegQuality: optionalNumber(value.jpegQuality) }
      : {}),
  };
  return hasKeys(normalized) ? normalized : undefined;
}

function normalizeInputLimits(value: unknown): ProviderModelPiInputLimits | undefined {
  if (!isRecord(value)) return undefined;
  const imagesInput = isRecord(value.images) ? value.images : {};
  const images: ProviderModelPiInputLimits['images'] = {
    ...(normalizeImageResize(imagesInput.resize)
      ? { resize: normalizeImageResize(imagesInput.resize) }
      : {}),
    ...(optionalNumber(imagesInput.maxPerMessage) !== undefined
      ? { maxPerMessage: optionalNumber(imagesInput.maxPerMessage) }
      : {}),
    ...(optionalNumber(imagesInput.maxPerRequest) !== undefined
      ? { maxPerRequest: optionalNumber(imagesInput.maxPerRequest) }
      : {}),
  };
  const normalized: ProviderModelPiInputLimits = {
    ...(optionalNumber(value.maxRequestBytes) !== undefined
      ? { maxRequestBytes: optionalNumber(value.maxRequestBytes) }
      : {}),
    ...(hasKeys(images) ? { images } : {}),
  };
  return hasKeys(normalized) ? normalized : undefined;
}

function normalizeCompaction(value: unknown): ProviderModelPiCompaction | undefined {
  if (!isRecord(value)) return undefined;
  const normalized: ProviderModelPiCompaction = {
    ...(optionalNumber(value.reserveTokens) !== undefined
      ? { reserveTokens: optionalNumber(value.reserveTokens) }
      : {}),
    ...(optionalNumber(value.keepRecentTokens) !== undefined
      ? { keepRecentTokens: optionalNumber(value.keepRecentTokens) }
      : {}),
  };
  return hasKeys(normalized) ? normalized : undefined;
}

export function normalizeProviderModelPiRuntimeConfig(
  input: unknown,
): ProviderModelPiRuntimeConfig | undefined {
  if (!isRecord(input)) return undefined;

  const compatInput = isRecord(input.compat) ? input.compat : {};
  const compat: ProviderModelPiRuntimeCompat = {
    ...(optionalBoolean(compatInput.supportsDeveloperRole) !== undefined
      ? { supportsDeveloperRole: optionalBoolean(compatInput.supportsDeveloperRole) }
      : {}),
    ...(optionalBoolean(compatInput.supportsReasoningEffort) !== undefined
      ? { supportsReasoningEffort: optionalBoolean(compatInput.supportsReasoningEffort) }
      : {}),
    ...(optionalBoolean(compatInput.supportsUsageInStreaming) !== undefined
      ? { supportsUsageInStreaming: optionalBoolean(compatInput.supportsUsageInStreaming) }
      : {}),
    ...(optionalBoolean(compatInput.supportsStrictMode) !== undefined
      ? { supportsStrictMode: optionalBoolean(compatInput.supportsStrictMode) }
      : {}),
    ...(optionalEnum<ProviderModelPiMaxTokensField>(
      compatInput.maxTokensField,
      MAX_TOKENS_FIELD_VALUES,
    )
      ? {
          maxTokensField: optionalEnum<ProviderModelPiMaxTokensField>(
            compatInput.maxTokensField,
            MAX_TOKENS_FIELD_VALUES,
          ),
        }
      : {}),
    ...(optionalBoolean(compatInput.requiresToolResultName) !== undefined
      ? { requiresToolResultName: optionalBoolean(compatInput.requiresToolResultName) }
      : {}),
    ...(optionalBoolean(compatInput.requiresAssistantAfterToolResult) !== undefined
      ? {
          requiresAssistantAfterToolResult: optionalBoolean(
            compatInput.requiresAssistantAfterToolResult,
          ),
        }
      : {}),
    ...(optionalBoolean(compatInput.requiresThinkingAsText) !== undefined
      ? { requiresThinkingAsText: optionalBoolean(compatInput.requiresThinkingAsText) }
      : {}),
    ...(optionalBoolean(compatInput.requiresReasoningContentOnAssistantMessages) !== undefined
      ? {
          requiresReasoningContentOnAssistantMessages: optionalBoolean(
            compatInput.requiresReasoningContentOnAssistantMessages,
          ),
        }
      : {}),
    ...(optionalEnum<ProviderModelPiThinkingFormat>(
      compatInput.thinkingFormat,
      THINKING_FORMAT_VALUES,
    )
      ? {
          thinkingFormat: optionalEnum<ProviderModelPiThinkingFormat>(
            compatInput.thinkingFormat,
            THINKING_FORMAT_VALUES,
          ),
        }
      : {}),
    ...(optionalEnum<ProviderModelPiCacheControlFormat>(
      compatInput.cacheControlFormat,
      CACHE_CONTROL_FORMAT_VALUES,
    )
      ? {
          cacheControlFormat: optionalEnum<ProviderModelPiCacheControlFormat>(
            compatInput.cacheControlFormat,
            CACHE_CONTROL_FORMAT_VALUES,
          ),
        }
      : {}),
    ...(optionalBoolean(compatInput.supportsFinishReason) !== undefined
      ? { supportsFinishReason: optionalBoolean(compatInput.supportsFinishReason) }
      : {}),
    ...(optionalBoolean(compatInput.supportsStore) !== undefined
      ? { supportsStore: optionalBoolean(compatInput.supportsStore) }
      : {}),
    ...(optionalStringRecord(compatInput.chatTemplateKwargs)
      ? { chatTemplateKwargs: optionalStringRecord(compatInput.chatTemplateKwargs) }
      : {}),
    ...(optionalStringRecord(compatInput.chatTemplateArgs)
      ? { chatTemplateArgs: optionalStringRecord(compatInput.chatTemplateArgs) }
      : {}),
    ...(optionalEnum<ProviderModelPiThinkingBudgetField>(
      compatInput.thinkingTokenBudgetField,
      THINKING_BUDGET_FIELD_VALUES,
    )
      ? {
          thinkingTokenBudgetField: optionalEnum<ProviderModelPiThinkingBudgetField>(
            compatInput.thinkingTokenBudgetField,
            THINKING_BUDGET_FIELD_VALUES,
          ),
        }
      : {}),
    ...(optionalBoolean(compatInput.supportsThinkingTokenBudget) !== undefined
      ? {
          supportsThinkingTokenBudget: optionalBoolean(compatInput.supportsThinkingTokenBudget),
        }
      : {}),
    ...(optionalBoolean(compatInput.supportsOpenAIGrammarTools) !== undefined
      ? { supportsOpenAIGrammarTools: optionalBoolean(compatInput.supportsOpenAIGrammarTools) }
      : {}),
    ...(optionalBoolean(compatInput.supportsMidConvoSystemMessages) !== undefined
      ? {
          supportsMidConvoSystemMessages: optionalBoolean(
            compatInput.supportsMidConvoSystemMessages,
          ),
        }
      : {}),
    ...(optionalBoolean(compatInput.supportsMidConvoToolAdditions) !== undefined
      ? {
          supportsMidConvoToolAdditions: optionalBoolean(compatInput.supportsMidConvoToolAdditions),
        }
      : {}),
    ...(optionalBoolean(compatInput.sendSessionAffinityHeaders) !== undefined
      ? {
          sendSessionAffinityHeaders: optionalBoolean(compatInput.sendSessionAffinityHeaders),
        }
      : {}),
    ...(optionalEnum<ProviderModelPiSessionAffinityFormat>(
      compatInput.sessionAffinityFormat,
      SESSION_AFFINITY_FORMAT_VALUES,
    )
      ? {
          sessionAffinityFormat: optionalEnum<ProviderModelPiSessionAffinityFormat>(
            compatInput.sessionAffinityFormat,
            SESSION_AFFINITY_FORMAT_VALUES,
          ),
        }
      : {}),
    ...(optionalBoolean(compatInput.supportsLongCacheRetention) !== undefined
      ? { supportsLongCacheRetention: optionalBoolean(compatInput.supportsLongCacheRetention) }
      : {}),
    ...(optionalNumber(compatInput.vllmPriority) !== undefined
      ? { vllmPriority: optionalNumber(compatInput.vllmPriority) }
      : {}),
    ...(optionalBoolean(compatInput.zaiToolStream) !== undefined
      ? { zaiToolStream: optionalBoolean(compatInput.zaiToolStream) }
      : {}),
  };

  const config: ProviderModelPiRuntimeConfig = {
    ...(optionalEnum<ProviderModelPiApi>(input.api, PI_API_VALUES)
      ? { api: input.api as ProviderModelPiApi }
      : {}),
    ...(optionalBoolean(input.reasoning) !== undefined
      ? { reasoning: optionalBoolean(input.reasoning) }
      : {}),
    ...(normalizeThinkingLevelMap(input.thinkingLevelMap)
      ? { thinkingLevelMap: normalizeThinkingLevelMap(input.thinkingLevelMap) }
      : {}),
    ...(hasKeys(compat) ? { compat } : {}),
    ...(normalizeInputLimits(input.inputLimits)
      ? { inputLimits: normalizeInputLimits(input.inputLimits) }
      : {}),
    ...(normalizeCompaction(input.compaction)
      ? { compaction: normalizeCompaction(input.compaction) }
      : {}),
    ...(isRecord(input.promptCache) ? { promptCache: input.promptCache } : {}),
    ...(isRecord(input.samplingParams) ? { samplingParams: input.samplingParams } : {}),
  };

  return hasKeys(config) ? config : undefined;
}

export function resolveProviderModelPiReasoning(
  piRuntime?: ProviderModelPiRuntimeConfig,
  capabilities?: Partial<ModelCapabilities>,
): boolean {
  return piRuntime?.reasoning ?? capabilities?.reasoning === ModelCapabilityStatus.Supported;
}
