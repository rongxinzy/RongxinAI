import { expect, test } from 'vitest';

import { type AppConfig, defaultConfig } from '../config';
import { reconcileDefaultModelConfig } from './modelConfigReconciliation';

const createConfig = (): AppConfig => structuredClone(defaultConfig);

test('keeps the current default model when its provider and ID remain available', () => {
  const config = createConfig();
  config.providers!.deepseek.enabled = true;
  config.providers!.deepseek.apiKey = 'key';

  const result = reconcileDefaultModelConfig(config, config.providers!);

  expect(result.defaultModel).toBe(config.model.defaultModel);
  expect(result.defaultModelProvider).toBe(config.model.defaultModelProvider);
});

test('falls back when the current default model was deleted', () => {
  const config = createConfig();
  config.providers!.deepseek.enabled = true;
  config.providers!.deepseek.apiKey = 'key';
  config.providers!.deepseek.models = config.providers!.deepseek.models!.filter(
    model => model.id !== config.model.defaultModel,
  );

  const result = reconcileDefaultModelConfig(config, config.providers!);

  expect(result.defaultModel).toBe(config.providers!.deepseek.models![0].id);
  expect(result.defaultModelProvider).toBe('deepseek');
});

test('matches duplicate model IDs by provider', () => {
  const config = createConfig();
  config.model.defaultModel = 'shared-model';
  config.model.defaultModelProvider = 'openai';
  config.providers = {
    first: {
      enabled: true,
      apiKey: 'first-key',
      baseUrl: 'https://first.example.com',
      apiFormat: 'openai',
      models: [{ id: 'shared-model', name: 'First' }],
    },
    openai: {
      enabled: true,
      apiKey: 'openai-key',
      baseUrl: 'https://api.openai.com/v1',
      apiFormat: 'openai',
      models: [{ id: 'shared-model', name: 'OpenAI' }],
    },
  };

  const result = reconcileDefaultModelConfig(config, config.providers);

  expect(result.defaultModelProvider).toBe('openai');
});

test('keeps the previous default when no model is available', () => {
  const config = createConfig();
  const providers = Object.fromEntries(
    Object.entries(config.providers!).map(([key, provider]) => [
      key,
      { ...provider, enabled: false, apiKey: '', models: [] },
    ]),
  );

  expect(reconcileDefaultModelConfig(config, providers)).toEqual(config.model);
});
