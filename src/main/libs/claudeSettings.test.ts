import { ZhiyuanModelPool } from '../../shared/modelPool/constants';
import { getCoworkOpenAICompatProxyStatus } from './coworkOpenAICompatProxy';
import { defaultConfig } from '../../renderer/config';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('./coworkOpenAICompatProxy', () => ({
  configureCoworkOpenAICompatProxy: vi.fn(),
  getCoworkOpenAICompatProxyBaseURL: () => 'http://127.0.0.1:3456/v1',
  getCoworkOpenAICompatProxyStatus: vi.fn(() => ({ running: true })),
  getCoworkOpenAICompatProxyToken: () => 'proxy-auth-token',
}));

import {
  ModelCapabilityStatus,
  ProviderModelPiApi,
  ProviderModelPiMaxTokensField,
  ProviderName,
} from '../../shared/providers';
import {
  resolveAllEnabledProviderConfigs,
  resolveCurrentApiConfig,
  resolveRawApiConfig,
  resolveRawApiConfigForModelRef,
  setStoreGetter,
  clearOllamaRuntimeModels,
  updateOllamaRuntimeModelCapabilities,
  updateOllamaRuntimeModels,
  updateLlamaCppRunningModels,
} from './claudeSettings';
import { buildLlamaCppRunningModelBinding } from './llamacppAgentBinding';

const createAppConfig = (defaultModel: string) => ({
  model: {
    defaultModel,
    defaultModelProvider: ProviderName.LlamaCpp,
  },
  providers: {
    [ProviderName.LlamaCpp]: {
      enabled: true,
      userEnabled: true,
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiFormat: 'openai' as const,
      models: [],
    },
  },
});

beforeEach(() => {
  updateLlamaCppRunningModels([]);
  clearOllamaRuntimeModels();
});

afterEach(() => {
  updateLlamaCppRunningModels([]);
  clearOllamaRuntimeModels();
  setStoreGetter(() => null);
});

test('resolveRawApiConfig forwards Ollama runtime context and capabilities', () => {
  updateOllamaRuntimeModels([{ name: 'qwen-local', context_length: 65536 }]);
  updateOllamaRuntimeModelCapabilities('qwen-local', {
    capabilities: ['completion', 'tools', 'thinking'],
  });
  setStoreGetter(
    () =>
      ({
        get: (key: string) =>
          key === 'app_config'
            ? {
                model: {
                  defaultModel: 'qwen-local',
                  defaultModelProvider: ProviderName.Ollama,
                },
                providers: {
                  [ProviderName.Ollama]: {
                    enabled: true,
                    userEnabled: true,
                    apiKey: '',
                    baseUrl: 'http://127.0.0.1:11434',
                    apiFormat: 'openai' as const,
                    models: [{ id: 'qwen-local', name: 'qwen-local' }],
                  },
                },
              }
            : undefined,
      }) as never,
  );

  const result = resolveRawApiConfig();
  expect(result.endpoint?.runtime).toMatchObject({
    kind: 'ollama',
    status: 'loaded',
    runtimeModelId: 'qwen-local',
    runtimeContextWindow: 65536,
    detectedCapabilities: {
      toolCalling: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    },
  });
});

test('resolveRawApiConfig forwards llama.cpp runtime metadata for the selected running model', () => {
  const runningModel = buildLlamaCppRunningModelBinding({
    name: 'qwen-local',
    trained_context_length: 32768,
    runtime_context_length: 32768,
  });
  expect(runningModel).not.toBeNull();
  updateLlamaCppRunningModels([runningModel!]);

  setStoreGetter(
    () =>
      ({
        get: (key: string) => (key === 'app_config' ? createAppConfig('qwen-local') : undefined),
      }) as never,
  );

  const result = resolveRawApiConfig();
  expect(result.config).toEqual({
    apiKey: 'sk-zhiyuan-local',
    baseURL: 'http://127.0.0.1:8080/v1',
    model: 'qwen-local',
    apiType: 'openai',
  });
  expect(result.providerMetadata).toEqual({
    providerName: ProviderName.LlamaCpp,
    authType: undefined,
    codingPlanEnabled: false,
    supportsImage: false,
    modelName: 'qwen-local',
    contextWindow: 32768,
    contextTokens: 32768,
    maxTokens: 4096,
  });
});

test('resolveRawApiConfig resolves a selected running llama.cpp model when provider is disabled', () => {
  const runningModel = buildLlamaCppRunningModelBinding({
    name: 'qwen-disabled-provider',
    trained_context_length: 32768,
    runtime_context_length: 32768,
  });
  expect(runningModel).not.toBeNull();
  updateLlamaCppRunningModels([runningModel!]);

  const appConfig = createAppConfig('qwen-disabled-provider');
  appConfig.providers[ProviderName.LlamaCpp] = {
    ...appConfig.providers[ProviderName.LlamaCpp],
    enabled: false,
    userEnabled: false,
  };

  setStoreGetter(
    () =>
      ({
        get: (key: string) => (key === 'app_config' ? appConfig : undefined),
      }) as never,
  );

  const result = resolveRawApiConfig();
  expect(result.config).toEqual({
    apiKey: 'sk-zhiyuan-local',
    baseURL: 'http://127.0.0.1:8080/v1',
    model: 'qwen-disabled-provider',
    apiType: 'openai',
  });
  expect(result.providerMetadata).toMatchObject({
    providerName: ProviderName.LlamaCpp,
    modelName: 'qwen-disabled-provider',
    contextWindow: 32768,
    contextTokens: 32768,
    maxTokens: 4096,
  });
});

test('resolveRawApiConfig uses registered DeepSeek V4 capacity when saved metadata is absent', () => {
  setStoreGetter(
    () =>
      ({
        get: (key: string) =>
          key === 'app_config'
            ? {
                model: {
                  defaultModel: 'deepseek-v4-flash',
                  defaultModelProvider: ProviderName.DeepSeek,
                },
                providers: {
                  [ProviderName.DeepSeek]: {
                    enabled: true,
                    apiKey: 'test-key',
                    baseUrl: 'https://api.deepseek.com',
                    apiFormat: 'openai',
                    models: [
                      {
                        id: 'deepseek-v4-flash',
                        name: 'DeepSeek V4 Flash',
                        supportsImage: false,
                      },
                    ],
                  },
                },
              }
            : undefined,
      }) as never,
  );

  const result = resolveRawApiConfig();

  expect(result.providerMetadata).toMatchObject({
    providerName: ProviderName.DeepSeek,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
  });
});

test('resolveRawApiConfig repairs stale catalog capabilities before Pi runtime routing', () => {
  setStoreGetter(
    () =>
      ({
        get: (key: string) =>
          key === 'app_config'
            ? {
                model: {
                  defaultModel: 'gpt-5.4',
                  defaultModelProvider: ProviderName.OpenAI,
                },
                providers: {
                  [ProviderName.OpenAI]: {
                    enabled: true,
                    apiKey: 'test-key',
                    baseUrl: 'https://api.openai.com/v1',
                    apiFormat: 'openai',
                    models: [
                      {
                        id: 'gpt-5.4',
                        name: 'GPT-5.4',
                        supportsImage: false,
                        capabilities: {
                          toolCalling: ModelCapabilityStatus.Unsupported,
                          imageInput: ModelCapabilityStatus.Unsupported,
                        },
                      },
                    ],
                  },
                },
              }
            : undefined,
      }) as never,
  );

  const result = resolveRawApiConfig();

  expect(result.providerMetadata).toMatchObject({
    providerName: ProviderName.OpenAI,
    supportsImage: true,
    capabilities: {
      toolCalling: ModelCapabilityStatus.Supported,
      imageInput: ModelCapabilityStatus.Supported,
    },
  });
});

test('resolveRawApiConfig uses registered coding-plan capacity when saved metadata is absent', () => {
  setStoreGetter(
    () =>
      ({
        get: (key: string) =>
          key === 'app_config'
            ? {
                model: {
                  defaultModel: 'kimi-for-coding',
                  defaultModelProvider: ProviderName.Moonshot,
                },
                providers: {
                  [ProviderName.Moonshot]: {
                    enabled: true,
                    apiKey: 'test-key',
                    baseUrl: 'https://api.moonshot.cn/v1',
                    apiFormat: 'openai',
                    codingPlanEnabled: true,
                    models: [
                      {
                        id: 'kimi-for-coding',
                        name: 'Kimi for Coding',
                        supportsImage: true,
                      },
                    ],
                  },
                },
              }
            : undefined,
      }) as never,
  );

  const result = resolveRawApiConfig();

  expect(result.providerMetadata).toMatchObject({
    providerName: ProviderName.Moonshot,
    contextWindow: 262_144,
    maxTokens: 32_768,
  });
});

test('resolveRawApiConfig ignores stale general models while coding plan is enabled', () => {
  setStoreGetter(
    () =>
      ({
        get: (key: string) =>
          key === 'app_config'
            ? {
                model: {
                  defaultModel: 'kimi-k2.6',
                  defaultModelProvider: ProviderName.Moonshot,
                },
                providers: {
                  [ProviderName.Moonshot]: {
                    enabled: true,
                    apiKey: 'test-key',
                    baseUrl: 'https://api.moonshot.cn/v1',
                    apiFormat: 'openai',
                    codingPlanEnabled: true,
                    models: [
                      { id: 'kimi-k2.6', name: 'Kimi K2.6', supportsImage: true },
                      { id: 'kimi-for-coding', name: 'Kimi K2.5', supportsImage: true },
                    ],
                  },
                },
              }
            : undefined,
      }) as never,
  );

  const result = resolveRawApiConfig();

  expect(result.config).toMatchObject({
    model: 'kimi-for-coding',
    apiType: 'anthropic',
  });
  expect(result.providerMetadata).toMatchObject({
    providerName: ProviderName.Moonshot,
    modelName: 'Kimi for Coding',
  });
});

test('resolveAllEnabledProviderConfigs only exposes Agent-eligible llama.cpp running models', () => {
  const eligible = buildLlamaCppRunningModelBinding({
    name: 'qwen-eligible',
    trained_context_length: 32768,
    runtime_context_length: 32768,
  });
  const fixableButIneligible = buildLlamaCppRunningModelBinding({
    name: 'qwen-small-runtime',
    trained_context_length: 32768,
    runtime_context_length: 4096,
  });
  const unknownRuntime = buildLlamaCppRunningModelBinding({
    name: 'qwen-unknown-runtime',
    trained_context_length: 32768,
  });
  updateLlamaCppRunningModels([eligible!, fixableButIneligible!, unknownRuntime!]);

  setStoreGetter(
    () =>
      ({
        get: (key: string) => (key === 'app_config' ? createAppConfig('qwen-eligible') : undefined),
      }) as never,
  );

  const providers = resolveAllEnabledProviderConfigs();
  expect(providers).toEqual([
    expect.objectContaining({
      providerName: ProviderName.LlamaCpp,
      models: [
        expect.objectContaining({
          id: 'qwen-eligible',
          contextWindow: 32768,
          contextTokens: 32768,
          maxTokens: 4096,
        }),
      ],
    }),
  ]);
});

test('resolveCurrentApiConfig still resolves a running llama.cpp model even when its context is too small', () => {
  const runningModel = buildLlamaCppRunningModelBinding({
    name: 'qwen-small-runtime',
    trained_context_length: 32768,
    runtime_context_length: 4096,
  });
  expect(runningModel).not.toBeNull();
  updateLlamaCppRunningModels([runningModel!]);

  setStoreGetter(
    () =>
      ({
        get: (key: string) =>
          key === 'app_config' ? createAppConfig('qwen-small-runtime') : undefined,
      }) as never,
  );

  const result = resolveCurrentApiConfig();
  expect(result.config).toEqual({
    apiKey: 'proxy-auth-token',
    baseURL: expect.stringContaining('/v1'),
    model: 'qwen-small-runtime',
    apiType: 'openai',
  });
  expect(result.providerMetadata).toEqual({
    providerName: ProviderName.LlamaCpp,
    codingPlanEnabled: false,
    supportsImage: false,
    modelName: 'qwen-small-runtime',
    contextWindow: 4096,
    contextTokens: 4096,
    maxTokens: 1024,
  });
});

test('resolveRawApiConfigForModelRef resolves an explicit llama.cpp model ref', () => {
  const runningModel = buildLlamaCppRunningModelBinding({
    name: 'qwen-explicit',
    trained_context_length: 32768,
    runtime_context_length: 32768,
  });
  expect(runningModel).not.toBeNull();
  updateLlamaCppRunningModels([runningModel!]);

  setStoreGetter(
    () =>
      ({
        get: (key: string) => (key === 'app_config' ? createAppConfig('qwen-local') : undefined),
      }) as never,
  );

  const result = resolveRawApiConfigForModelRef('llamacpp/qwen-explicit');
  expect(result.config).toEqual({
    apiKey: 'sk-zhiyuan-local',
    baseURL: 'http://127.0.0.1:8080/v1',
    model: 'qwen-explicit',
    apiType: 'openai',
  });
  expect(result.providerMetadata).toEqual({
    providerName: ProviderName.LlamaCpp,
    authType: undefined,
    codingPlanEnabled: false,
    supportsImage: false,
    modelName: 'qwen-explicit',
    contextWindow: 32768,
    contextTokens: 32768,
    maxTokens: 4096,
  });
});

test('resolveRawApiConfigForModelRef accepts the runtime provider ID for Zhipu', () => {
  setStoreGetter(
    () =>
      ({
        get: (key: string) =>
          key === 'app_config'
            ? {
                model: {
                  defaultModel: 'glm-5.2',
                  defaultModelProvider: ProviderName.Zhipu,
                },
                providers: {
                  [ProviderName.Zhipu]: {
                    enabled: true,
                    apiKey: 'sk-zhipu',
                    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
                    apiFormat: 'anthropic' as const,
                    models: [{ id: 'glm-5.2', name: 'GLM 5.2' }],
                  },
                },
              }
            : undefined,
      }) as never,
  );

  const result = resolveRawApiConfigForModelRef('zai/glm-5.2');
  expect(result.config).toEqual({
    apiKey: 'sk-zhipu',
    baseURL: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-5.2',
    apiType: 'anthropic',
  });
  expect(result.providerMetadata?.providerName).toBe(ProviderName.Zhipu);
});

test('resolveRawApiConfigForModelRef resolves explicit llama.cpp model when provider is disabled', () => {
  const runningModel = buildLlamaCppRunningModelBinding({
    name: 'qwen-explicit-disabled',
    trained_context_length: 32768,
    runtime_context_length: 32768,
  });
  expect(runningModel).not.toBeNull();
  updateLlamaCppRunningModels([runningModel!]);

  const appConfig = createAppConfig('qwen-local');
  appConfig.providers[ProviderName.LlamaCpp] = {
    ...appConfig.providers[ProviderName.LlamaCpp],
    enabled: false,
    userEnabled: false,
  };

  setStoreGetter(
    () =>
      ({
        get: (key: string) => (key === 'app_config' ? appConfig : undefined),
      }) as never,
  );

  const result = resolveRawApiConfigForModelRef('llamacpp/qwen-explicit-disabled');
  expect(result.config).toEqual({
    apiKey: 'sk-zhiyuan-local',
    baseURL: 'http://127.0.0.1:8080/v1',
    model: 'qwen-explicit-disabled',
    apiType: 'openai',
  });
  expect(result.providerMetadata).toMatchObject({
    providerName: ProviderName.LlamaCpp,
    modelName: 'qwen-explicit-disabled',
    contextWindow: 32768,
    contextTokens: 32768,
    maxTokens: 4096,
  });
});

test('resolveRawApiConfigForModelRef forwards custom model Pi runtime metadata', () => {
  const CustomProviderKey = {
    Primary: 'custom_0',
  } as const;

  setStoreGetter(
    () =>
      ({
        get: (key: string) =>
          key === 'app_config'
            ? {
                model: {
                  defaultModel: 'agent-model',
                  defaultModelProvider: CustomProviderKey.Primary,
                },
                providers: {
                  [CustomProviderKey.Primary]: {
                    enabled: true,
                    apiKey: 'sk-custom',
                    baseUrl: 'https://custom.example/v1',
                    apiFormat: 'openai' as const,
                    models: [
                      {
                        id: 'agent-model',
                        name: 'Agent Model',
                        supportsImage: true,
                        capabilities: {
                          toolCalling: ModelCapabilityStatus.Supported,
                          reasoning: ModelCapabilityStatus.Supported,
                        },
                        piRuntime: {
                          api: ProviderModelPiApi.OpenAIResponses,
                          reasoning: true,
                          compat: {
                            supportsDeveloperRole: false,
                            maxTokensField: ProviderModelPiMaxTokensField.MaxTokens,
                          },
                        },
                      },
                    ],
                  },
                },
              }
            : undefined,
      }) as never,
  );

  const result = resolveRawApiConfigForModelRef('custom_0/agent-model');
  expect(result.config).toEqual({
    apiKey: 'sk-custom',
    baseURL: 'https://custom.example/v1',
    model: 'agent-model',
    apiType: 'openai',
  });
  expect(result.providerMetadata).toEqual(
    expect.objectContaining({
      providerName: CustomProviderKey.Primary,
      supportsImage: true,
      modelName: 'Agent Model',
      capabilities: expect.objectContaining({
        toolCalling: ModelCapabilityStatus.Supported,
        reasoning: ModelCapabilityStatus.Supported,
      }),
      piRuntime: {
        api: ProviderModelPiApi.OpenAIResponses,
        reasoning: true,
        compat: {
          supportsDeveloperRole: false,
          maxTokensField: ProviderModelPiMaxTokensField.MaxTokens,
        },
      },
    }),
  );
});

test('managed free model is available without a user key or compatibility proxy', () => {
  vi.mocked(getCoworkOpenAICompatProxyStatus).mockReturnValue({ running: false } as ReturnType<
    typeof getCoworkOpenAICompatProxyStatus
  >);
  const config = structuredClone(defaultConfig);
  setStoreGetter(() => ({ get: () => config }) as never);
  try {
    const resolved = resolveRawApiConfig();
    expect(resolved.error).toBeUndefined();
    expect(resolved.config?.model).toBe(ZhiyuanModelPool.FreeModelId);
    expect(resolved.config?.apiKey).toBe('sk-zhiyuan-managed');
    expect(resolved.providerMetadata?.providerName).toBe(ProviderName.Zhiyuan);
    expect(resolveCurrentApiConfig().config).toBeNull();
  } finally {
    vi.mocked(getCoworkOpenAICompatProxyStatus).mockReturnValue({ running: true } as ReturnType<
      typeof getCoworkOpenAICompatProxyStatus
    >);
  }
});
