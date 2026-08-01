import { afterEach, expect, test, vi } from 'vitest';

import { ModelCapabilityStatus, ProviderName } from '../../shared/providers';
import type { AppConfig } from '../config';
import { defaultConfig } from '../config';
import { buildConfiguredAvailableModels, collectAvailableModels } from './availableModels';

function createConfig(): AppConfig {
  return {
    ...defaultConfig,
    api: { ...defaultConfig.api },
    model: {
      ...defaultConfig.model,
      availableModels: [...defaultConfig.model.availableModels],
    },
    providers: {
      ...(defaultConfig.providers ?? {}),
      [ProviderName.DeepSeek]: {
        enabled: true,
        apiKey: 'sk-test',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiFormat: 'anthropic',
        models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', supportsImage: false }],
      },
      [ProviderName.LlamaCpp]: {
        enabled: false,
        userEnabled: false,
        apiKey: '',
        baseUrl: 'http://127.0.0.1:8080/v1',
        apiFormat: 'openai',
        models: [{ id: 'qwen-local', name: 'qwen-local', supportsImage: false }],
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('collectAvailableModels does not expose running llama.cpp models when provider is disabled', async () => {
  const listRunningModels = vi.fn(async () => [
    { name: 'qwen-local', runtime_context_length: 8192 },
  ]);
  vi.stubGlobal('window', {
    electron: {
      llamacpp: {
        listRunningModels,
      },
    },
  });

  const models = await collectAvailableModels(createConfig());

  expect(listRunningModels).not.toHaveBeenCalled();
  expect(models.some(model => model.providerKey === ProviderName.LlamaCpp)).toBe(false);
  expect(models.some(model => model.providerKey === ProviderName.DeepSeek)).toBe(true);
});

test('collectAvailableModels merges running llama.cpp models only when provider is user-enabled', async () => {
  const listRunningModels = vi.fn(async () => [
    {
      name: 'qwen-local',
      runtime_context_length: 8192,
      trained_context_length: 32768,
      supportsThinkingToggle: true,
    },
  ]);
  vi.stubGlobal('window', {
    electron: {
      llamacpp: {
        listRunningModels,
      },
    },
  });
  const config = createConfig();
  if (config.providers) {
    config.providers[ProviderName.LlamaCpp] = {
      ...config.providers[ProviderName.LlamaCpp],
      enabled: true,
      userEnabled: true,
    };
  }

  const models = await collectAvailableModels(config);

  expect(listRunningModels).toHaveBeenCalledTimes(1);
  const llamaCppModel = models.find(
    model => model.providerKey === ProviderName.LlamaCpp && model.id === 'qwen-local',
  );
  expect(llamaCppModel).toBeDefined();
  expect(llamaCppModel?.llamaCppOpenClawEligibility).toMatchObject({
    eligible: false,
    runtimeContextWindow: 8192,
    trainedContextWindow: 32768,
  });
  expect(llamaCppModel?.supportsThinkingToggle).toBe(true);
});

test('preserves contextTokens for custom cloud models', () => {
  const config = createConfig();
  config.providers = {
    custom_usage: {
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      apiFormat: 'openai',
      models: [
        {
          id: 'custom-cloud-model',
          name: 'Custom Cloud Model',
          contextTokens: 131_072,
        },
      ],
    },
  };

  const model = buildConfiguredAvailableModels(config).find(
    item => item.id === 'custom-cloud-model',
  );

  expect(model?.contextWindow).toBe(131_072);
});

test('uses repaired provider metadata consistently for image flags and capabilities', () => {
  const config = createConfig();
  config.providers = {
    [ProviderName.Qwen]: {
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiFormat: 'openai',
      // Simulate a stale saved config from before qwen3.6-plus gained image metadata.
      models: [{ id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', supportsImage: false }],
    },
  };

  const model = buildConfiguredAvailableModels(config)[0];

  expect(model.supportsImage).toBe(true);
  expect(model.capabilities?.imageInput).toBe(ModelCapabilityStatus.Supported);
});

test('uses the canonical coding-plan catalog instead of stale saved provider models', () => {
  const config = createConfig();
  config.providers = {
    [ProviderName.Moonshot]: {
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiFormat: 'openai',
      codingPlanEnabled: true,
      // Reproduce a legacy config where the Settings view and chat picker diverged.
      models: [
        { id: 'kimi-k2.6', name: 'Kimi K2.6', supportsImage: true },
        { id: 'kimi-for-coding', name: 'Kimi K2.5', supportsImage: true },
      ],
    },
  };

  const models = buildConfiguredAvailableModels(config);

  expect(models.map(model => [model.id, model.name])).toEqual([
    ['kimi-for-coding', 'Kimi for Coding'],
  ]);
});
