import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('./coworkOpenAICompatProxy', () => ({
  configureCoworkOpenAICompatProxy: vi.fn(),
  getCoworkOpenAICompatProxyBaseURL: () => 'http://127.0.0.1:3456/v1',
  getCoworkOpenAICompatProxyStatus: () => ({ running: true }),
}));

import { ProviderName } from '../../shared/providers';
import {
  resolveAllEnabledProviderConfigs,
  resolveCurrentApiConfig,
  resolveRawApiConfig,
  resolveRawApiConfigForModelRef,
  setStoreGetter,
  updateLlamaCppRunningModels,
} from './claudeSettings';
import { buildLlamaCppRunningModelBinding } from './llamacppOpenClawBinding';

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
});

afterEach(() => {
  updateLlamaCppRunningModels([]);
  setStoreGetter(() => null);
});

test('resolveRawApiConfig forwards llama.cpp runtime metadata for the selected running model', () => {
  const runningModel = buildLlamaCppRunningModelBinding({
    name: 'qwen-local',
    trained_context_length: 32768,
    runtime_context_length: 32768,
  });
  expect(runningModel).not.toBeNull();
  updateLlamaCppRunningModels([runningModel!]);

  setStoreGetter(() => ({
    get: (key: string) => (key === 'app_config' ? createAppConfig('qwen-local') : undefined),
  } as never));

  const result = resolveRawApiConfig();
  expect(result.config).toEqual({
    apiKey: 'sk-lobsterai-local',
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

test('resolveAllEnabledProviderConfigs only exposes OpenClaw-eligible llama.cpp running models', () => {
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

  setStoreGetter(() => ({
    get: (key: string) => (key === 'app_config' ? createAppConfig('qwen-eligible') : undefined),
  } as never));

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

  setStoreGetter(() => ({
    get: (key: string) => (key === 'app_config' ? createAppConfig('qwen-small-runtime') : undefined),
  } as never));

  const result = resolveCurrentApiConfig();
  expect(result.config).toEqual({
    apiKey: 'lobsterai-openai-compat',
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

  setStoreGetter(() => ({
    get: (key: string) => (key === 'app_config' ? createAppConfig('qwen-local') : undefined),
  } as never));

  const result = resolveRawApiConfigForModelRef('llamacpp/qwen-explicit');
  expect(result.config).toEqual({
    apiKey: 'sk-lobsterai-local',
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
