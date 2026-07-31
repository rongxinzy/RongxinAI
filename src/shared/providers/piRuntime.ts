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
  Zai: 'zai',
  Qwen: 'qwen',
  ChatTemplate: 'chat-template',
  QwenChatTemplate: 'qwen-chat-template',
  StringThinking: 'string-thinking',
  AntLing: 'ant-ling',
} as const;
export type ProviderModelPiThinkingFormat =
  (typeof ProviderModelPiThinkingFormat)[keyof typeof ProviderModelPiThinkingFormat];

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
  readonly maxTokensField?: ProviderModelPiMaxTokensField;
  readonly requiresToolResultName?: boolean;
  readonly requiresAssistantAfterToolResult?: boolean;
  readonly requiresThinkingAsText?: boolean;
  readonly requiresReasoningContentOnAssistantMessages?: boolean;
  readonly thinkingFormat?: ProviderModelPiThinkingFormat;
  readonly cacheControlFormat?: ProviderModelPiCacheControlFormat;
}

export interface ProviderModelPiRuntimeConfig {
  readonly api?: ProviderModelPiApi;
  readonly reasoning?: boolean;
  readonly compat?: ProviderModelPiRuntimeCompat;
}

const PI_API_VALUES = new Set<string>(Object.values(ProviderModelPiApi));
const MAX_TOKENS_FIELD_VALUES = new Set<string>(Object.values(ProviderModelPiMaxTokensField));
const THINKING_FORMAT_VALUES = new Set<string>(Object.values(ProviderModelPiThinkingFormat));
const CACHE_CONTROL_FORMAT_VALUES = new Set<string>(
  Object.values(ProviderModelPiCacheControlFormat),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
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
  };

  const config: ProviderModelPiRuntimeConfig = {
    ...(optionalEnum<ProviderModelPiApi>(input.api, PI_API_VALUES)
      ? { api: input.api as ProviderModelPiApi }
      : {}),
    ...(optionalBoolean(input.reasoning) !== undefined
      ? { reasoning: optionalBoolean(input.reasoning) }
      : {}),
    ...(hasKeys(compat) ? { compat } : {}),
  };

  return hasKeys(config) ? config : undefined;
}

export function resolveProviderModelPiReasoning(
  piRuntime?: ProviderModelPiRuntimeConfig,
  capabilities?: Partial<ModelCapabilities>,
): boolean {
  return piRuntime?.reasoning ?? capabilities?.reasoning === ModelCapabilityStatus.Supported;
}
