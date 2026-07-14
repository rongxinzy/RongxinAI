import { afterEach, expect, test, vi } from 'vitest';

import { ProviderName } from '../../shared/providers';
import type { AppConfig } from '../config';
import { defaultConfig } from '../config';
import { collectAvailableModels } from './availableModels';

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
  const llamaCppModel = models.find(model =>
    model.providerKey === ProviderName.LlamaCpp && model.id === 'qwen-local',
  );
  expect(llamaCppModel).toBeDefined();
  expect(llamaCppModel?.llamaCppOpenClawEligibility).toMatchObject({
    eligible: false,
    runtimeContextWindow: 8192,
    trainedContextWindow: 32768,
  });
  expect(llamaCppModel?.supportsThinkingToggle).toBe(true);
});
