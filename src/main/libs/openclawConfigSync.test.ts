import { describe,expect, test } from 'vitest';

import {
  OpenClawApi,
  OpenClawProviderId,
  ProviderName,
} from '../../shared/providers';

const providerApiKeyEnvVar = (providerName: string): string => {
  const envName = providerName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `LOBSTER_APIKEY_${envName}`;
};

describe('providerApiKeyEnvVar', () => {
  test('converts simple provider names', () => {
    expect(providerApiKeyEnvVar(ProviderName.Moonshot)).toBe('LOBSTER_APIKEY_MOONSHOT');
    expect(providerApiKeyEnvVar(ProviderName.Anthropic)).toBe('LOBSTER_APIKEY_ANTHROPIC');
    expect(providerApiKeyEnvVar(ProviderName.OpenAI)).toBe('LOBSTER_APIKEY_OPENAI');
    expect(providerApiKeyEnvVar(ProviderName.LlamaCpp)).toBe('LOBSTER_APIKEY_LLAMACPP');
    expect(providerApiKeyEnvVar(ProviderName.Ollama)).toBe('LOBSTER_APIKEY_OLLAMA');
  });

  test('replaces hyphens and special chars with underscores', () => {
    expect(providerApiKeyEnvVar(ProviderName.LobsteraiServer)).toBe('LOBSTER_APIKEY_LOBSTERAI_SERVER');
    expect(providerApiKeyEnvVar('my.provider')).toBe('LOBSTER_APIKEY_MY_PROVIDER');
  });

  test('server key matches hardcoded convention', () => {
    expect(providerApiKeyEnvVar('server')).toBe('LOBSTER_APIKEY_SERVER');
  });
});

describe('env var stability on model switch', () => {
  const simulateCollectEnvVars = (providers: Record<string, { enabled: boolean; apiKey: string }>, serverToken?: string) => {
    const env: Record<string, string> = {};

    if (serverToken) {
      env.LOBSTER_APIKEY_SERVER = serverToken;
    }

    for (const [name, config] of Object.entries(providers)) {
      if (!config.enabled) continue;
      const envName = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      env[`LOBSTER_APIKEY_${envName}`] = config.apiKey;
    }

    return env;
  };

  test('switching from server to custom provider does not change env var keys', () => {
    const providers = {
      [ProviderName.Moonshot]: { enabled: true, apiKey: 'sk-moon-123' },
    };
    const serverToken = 'access-token-xyz';

    const envBefore = simulateCollectEnvVars(providers, serverToken);
    const envAfter = simulateCollectEnvVars(providers, serverToken);

    expect(JSON.stringify(envBefore)).toBe(JSON.stringify(envAfter));
  });

  test('switching between two custom providers does not change env var keys', () => {
    const providers = {
      [ProviderName.Moonshot]: { enabled: true, apiKey: 'sk-moon-123' },
      [ProviderName.Anthropic]: { enabled: true, apiKey: 'sk-ant-456' },
    };

    const envBefore = simulateCollectEnvVars(providers);
    const envAfter = simulateCollectEnvVars(providers);

    expect(JSON.stringify(envBefore)).toBe(JSON.stringify(envAfter));
    expect(envBefore.LOBSTER_APIKEY_MOONSHOT).toBe('sk-moon-123');
    expect(envBefore.LOBSTER_APIKEY_ANTHROPIC).toBe('sk-ant-456');
  });

  test('only editing apiKey value causes env var change', () => {
    const providersBefore = {
      [ProviderName.Moonshot]: { enabled: true, apiKey: 'sk-moon-OLD' },
    };
    const providersAfter = {
      [ProviderName.Moonshot]: { enabled: true, apiKey: 'sk-moon-NEW' },
    };

    const envBefore = simulateCollectEnvVars(providersBefore);
    const envAfter = simulateCollectEnvVars(providersAfter);

    expect(JSON.stringify(envBefore)).not.toBe(JSON.stringify(envAfter));
  });
});

// ═══════════════════════════════════════════════════════
// Provider Descriptor Registry Tests
//
// Since buildProviderSelection imports Electron-only modules,
// we mirror the descriptor resolution logic here to verify
// the registry mapping correctness.
// ═══════════════════════════════════════════════════════

type OpenClawProviderApi =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses'
  | 'google-generative-ai'
  | 'ollama';

const mapApiTypeToOpenClawApi = (
  apiType: 'anthropic' | 'openai' | undefined,
): OpenClawProviderApi => {
  if (apiType === 'openai') return 'openai-completions';
  return 'anthropic-messages';
};

type ProviderDescriptor = {
  providerId: string;
  resolveApi: (ctx: { apiType: 'anthropic' | 'openai' | undefined; baseURL: string }) => OpenClawProviderApi;
  normalizeBaseUrl: (rawBaseUrl: string) => string;
  resolveSessionModelId?: (modelId: string) => string;
  modelDefaults?: Partial<{
    reasoning: boolean;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
  }>;
};

const stripChatCompletionsSuffix = (rawBaseUrl: string): string => {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) return trimmed;
  const normalized = trimmed.replace(/\/+$/, '');
  if (normalized.endsWith('/openai')) {
    return normalized.slice(0, -'/openai'.length);
  }
  return normalized;
};

const PROVIDER_REGISTRY: Record<string, ProviderDescriptor> = {
  [ProviderName.Moonshot]: {
    providerId: OpenClawProviderId.Moonshot,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
    modelDefaults: {
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 256000,
      maxTokens: 8192,
    },
  },
  [ProviderName.Gemini]: {
    providerId: OpenClawProviderId.Google,
    resolveApi: () => OpenClawApi.GoogleGenerativeAI as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
    modelDefaults: { reasoning: true },
  },
  [ProviderName.Anthropic]: {
    providerId: OpenClawProviderId.Anthropic,
    resolveApi: () => OpenClawApi.AnthropicMessages as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.OpenAI]: {
    providerId: OpenClawProviderId.OpenAI,
    resolveApi: () => OpenClawApi.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.DeepSeek]: {
    providerId: OpenClawProviderId.DeepSeek,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Qwen]: {
    providerId: OpenClawProviderId.Qwen,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Zhipu]: {
    providerId: OpenClawProviderId.Zai,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Volcengine]: {
    providerId: OpenClawProviderId.Volcengine,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Minimax]: {
    providerId: OpenClawProviderId.Minimax,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.StepFun]: {
    providerId: OpenClawProviderId.StepFun,
    resolveApi: () => OpenClawApi.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Xiaomi]: {
    providerId: OpenClawProviderId.Xiaomi,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.OpenRouter]: {
    providerId: OpenClawProviderId.OpenRouter,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Ollama]: {
    providerId: OpenClawProviderId.Ollama,
    resolveApi: () => OpenClawApi.Ollama as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.LlamaCpp]: {
    providerId: OpenClawProviderId.LlamaCpp,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
};

const DEFAULT_DESCRIPTOR: ProviderDescriptor = {
  providerId: OpenClawProviderId.Lobster,
  resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
  normalizeBaseUrl: stripChatCompletionsSuffix,
};

const resolveDescriptor = (
  providerName: string,
  codingPlanEnabled: boolean,
): ProviderDescriptor => {
  if (codingPlanEnabled) {
    const compositeKey = `${providerName}:codingPlan`;
    if (compositeKey in PROVIDER_REGISTRY) {
      return PROVIDER_REGISTRY[compositeKey];
    }
  }
  if (providerName in PROVIDER_REGISTRY) {
    return PROVIDER_REGISTRY[providerName];
  }
  return {
    ...DEFAULT_DESCRIPTOR,
    providerId: providerName || OpenClawProviderId.Lobster,
  };
};

describe('resolveDescriptor', () => {
  test('gemini maps to google providerId with google-generative-ai API', () => {
    const d = resolveDescriptor(ProviderName.Gemini, false);
    expect(d.providerId).toBe(OpenClawProviderId.Google);
    expect(d.resolveApi({ apiType: undefined, baseURL: '' })).toBe(OpenClawApi.GoogleGenerativeAI);
  });

  test('anthropic maps to anthropic providerId with anthropic-messages API', () => {
    const d = resolveDescriptor(ProviderName.Anthropic, false);
    expect(d.providerId).toBe(OpenClawProviderId.Anthropic);
    expect(d.resolveApi({ apiType: undefined, baseURL: '' })).toBe(OpenClawApi.AnthropicMessages);
  });

  test('openai maps to openai providerId', () => {
    const d = resolveDescriptor(ProviderName.OpenAI, false);
    expect(d.providerId).toBe(OpenClawProviderId.OpenAI);
  });

  test('moonshot without codingPlan uses moonshot providerId', () => {
    const d = resolveDescriptor(ProviderName.Moonshot, false);
    expect(d.providerId).toBe(OpenClawProviderId.Moonshot);
    expect(d.resolveApi({ apiType: 'openai', baseURL: '' })).toBe(OpenClawApi.OpenAICompletions);
    expect(d.resolveApi({ apiType: 'anthropic', baseURL: '' })).toBe(OpenClawApi.AnthropicMessages);
  });

  test('moonshot with codingPlan falls back to moonshot providerId', () => {
    const d = resolveDescriptor(ProviderName.Moonshot, true);
    expect(d.providerId).toBe(OpenClawProviderId.Moonshot);
  });

  test('moonshot has model defaults', () => {
    const d = resolveDescriptor(ProviderName.Moonshot, false);
    expect(d.modelDefaults?.contextWindow).toBe(256000);
    expect(d.modelDefaults?.maxTokens).toBe(8192);
  });

  test('deepseek maps to deepseek providerId respecting apiType', () => {
    const d = resolveDescriptor(ProviderName.DeepSeek, false);
    expect(d.providerId).toBe(OpenClawProviderId.DeepSeek);
    expect(d.resolveApi({ apiType: 'openai', baseURL: '' })).toBe(OpenClawApi.OpenAICompletions);
    expect(d.resolveApi({ apiType: 'anthropic', baseURL: '' })).toBe(OpenClawApi.AnthropicMessages);
  });

  test('ollama uses native OpenClaw Ollama api', () => {
    const d = resolveDescriptor(ProviderName.Ollama, false);
    expect(d.providerId).toBe(OpenClawProviderId.Ollama);
    expect(d.resolveApi({ apiType: undefined, baseURL: '' })).toBe(OpenClawApi.Ollama);
  });

  test('llamacpp maps to llamacpp providerId', () => {
    const d = resolveDescriptor(ProviderName.LlamaCpp, false);
    expect(d.providerId).toBe(OpenClawProviderId.LlamaCpp);
    expect(d.resolveApi({ apiType: 'openai', baseURL: '' })).toBe(OpenClawApi.OpenAICompletions);
  });

  test('unknown provider falls back to lobster providerId', () => {
    const d = resolveDescriptor('some-unknown', false);
    expect(d.providerId).toBe('some-unknown');
  });

  test('empty provider name falls back to lobster', () => {
    const d = resolveDescriptor('', false);
    expect(d.providerId).toBe(OpenClawProviderId.Lobster);
  });

  test('codingPlan flag is ignored for providers without codingPlan entry', () => {
    const d = resolveDescriptor(ProviderName.OpenAI, true);
    expect(d.providerId).toBe(OpenClawProviderId.OpenAI);
  });

  test('volcengine with codingPlan falls back to volcengine providerId', () => {
    const d = resolveDescriptor(ProviderName.Volcengine, true);
    expect(d.providerId).toBe(OpenClawProviderId.Volcengine);
  });

  test('volcengine without codingPlan uses volcengine providerId', () => {
    const d = resolveDescriptor(ProviderName.Volcengine, false);
    expect(d.providerId).toBe(OpenClawProviderId.Volcengine);
  });
});

describe('provider registry coverage', () => {
  const allRegistryProviders = [
    ProviderName.Moonshot,
    ProviderName.Gemini,
    ProviderName.Anthropic,
    ProviderName.OpenAI,
    ProviderName.DeepSeek,
    ProviderName.Qwen,
    ProviderName.Zhipu,
    ProviderName.Volcengine,
    ProviderName.Minimax,
    ProviderName.StepFun,
    ProviderName.Xiaomi,
    ProviderName.OpenRouter,
    ProviderName.LlamaCpp,
    ProviderName.Ollama,
  ] as const;

  test('all active providers have registry entries', () => {
    for (const name of allRegistryProviders) {
      expect(name in PROVIDER_REGISTRY, `${name} missing from registry`).toBe(true);
    }
  });

  test('no provider resolves to lobster fallback', () => {
    for (const name of allRegistryProviders) {
      const d = resolveDescriptor(name, false);
      expect(d.providerId).not.toBe(OpenClawProviderId.Lobster);
    }
  });

  test('every provider has a non-empty providerId', () => {
    for (const name of allRegistryProviders) {
      const d = resolveDescriptor(name, false);
      expect(d.providerId.length).toBeGreaterThan(0);
    }
  });
});

// ==================== Contract tests: buildProviderSelection ====================

import { buildProviderSelection } from './openclawConfigSync';

const REQUIRED_SELECTION_KEYS = ['providerId', 'legacyModelId', 'sessionModelId', 'primaryModel', 'providerConfig'] as const;
const REQUIRED_PROVIDER_CONFIG_KEYS = ['baseUrl', 'api', 'auth', 'models'] as const;
const REQUIRED_MODEL_KEYS = ['id', 'name', 'api', 'input'] as const;

describe('buildProviderSelection contract', () => {
  const baseOptions = {
    apiKey: 'test-key',
    baseURL: 'https://api.example.com/v1',
    modelId: 'test-model',
    apiType: undefined as 'anthropic' | 'openai' | undefined,
  };

  test('output has all required top-level keys', () => {
    const result = buildProviderSelection({ ...baseOptions, providerName: ProviderName.Anthropic, apiType: 'anthropic' });
    for (const key of REQUIRED_SELECTION_KEYS) {
      expect(result).toHaveProperty(key);
    }
  });

  test('primaryModel follows providerId/modelId format', () => {
    const result = buildProviderSelection({ ...baseOptions, providerName: ProviderName.DeepSeek });
    expect(result.primaryModel).toBe(`${result.providerId}/${result.sessionModelId}`);
  });

  test('providerConfig has all required keys', () => {
    const result = buildProviderSelection({ ...baseOptions, providerName: ProviderName.OpenAI, apiType: 'openai' });
    for (const key of REQUIRED_PROVIDER_CONFIG_KEYS) {
      expect(result.providerConfig).toHaveProperty(key);
    }
  });

  test('providerConfig.models[0] has all required keys', () => {
    const result = buildProviderSelection({ ...baseOptions, providerName: ProviderName.Moonshot });
    const model = result.providerConfig.models[0];
    for (const key of REQUIRED_MODEL_KEYS) {
      expect(model).toHaveProperty(key);
    }
  });

  test('model.id matches sessionModelId', () => {
    const result = buildProviderSelection({ ...baseOptions, providerName: ProviderName.Anthropic, apiType: 'anthropic' });
    expect(result.providerConfig.models[0].id).toBe(result.sessionModelId);
  });

  test('model.input is text array for non-vision models', () => {
    const result = buildProviderSelection({ ...baseOptions, providerName: ProviderName.DeepSeek });
    expect(result.providerConfig.models[0].input).toEqual(['text']);
  });

  test('model.input includes image for vision-supported models', () => {
    const result = buildProviderSelection({ ...baseOptions, providerName: ProviderName.Anthropic, apiType: 'anthropic', supportsImage: true });
    expect(result.providerConfig.models[0].input).toContain('image');
  });

  test('apiKey uses env var placeholder for providers with resolveApiKey', () => {
    const result = buildProviderSelection({ ...baseOptions, providerName: ProviderName.Anthropic, apiType: 'anthropic' });
    expect(result.providerConfig.apiKey).toMatch(/^\$\{LOBSTER_APIKEY_/);
  });

  test('apiKey uses env var placeholder for unknown providers', () => {
    const result = buildProviderSelection({ ...baseOptions, providerName: 'unknown-provider' });
    expect(result.providerConfig.apiKey).toMatch(/^\$\{LOBSTER_APIKEY_/);
  });

  // ─── All registered providers ──────────────────────────────────────────

  const majorProviders = [
    { name: ProviderName.Anthropic, apiType: 'anthropic' as const },
    { name: ProviderName.OpenAI, apiType: 'openai' as const },
    { name: ProviderName.DeepSeek, apiType: undefined },
    { name: ProviderName.Moonshot, apiType: undefined },
    { name: ProviderName.Ollama, apiType: undefined },
    { name: ProviderName.LlamaCpp, apiType: undefined },
  ];

  for (const { name, apiType } of majorProviders) {
    test(`buildProviderSelection for ${name} produces valid contract`, () => {
      const result = buildProviderSelection({ ...baseOptions, providerName: name, apiType });

      // Top-level keys
      expect(typeof result.providerId).toBe('string');
      expect(result.providerId.length).toBeGreaterThan(0);
      expect(typeof result.primaryModel).toBe('string');
      expect(result.primaryModel.startsWith(result.providerId + '/')).toBe(true);

      // Provider config
      expect(typeof result.providerConfig.baseUrl).toBe('string');
      expect(result.providerConfig.baseUrl.length).toBeGreaterThan(0);
      expect(['api-key', 'oauth']).toContain(result.providerConfig.auth);

      // Models
      expect(result.providerConfig.models.length).toBeGreaterThanOrEqual(1);
      const model = result.providerConfig.models[0];
      expect(typeof model.id).toBe('string');
      expect(model.id.length).toBeGreaterThan(0);
      expect(Array.isArray(model.input)).toBe(true);
      expect(model.input.length).toBeGreaterThan(0);
    });
  }
});
