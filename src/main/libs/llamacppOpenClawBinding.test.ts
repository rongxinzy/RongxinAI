import { expect, test } from 'vitest';

import { ProviderName } from '../../shared/providers';
import {
  buildLlamaCppRunningModelBinding,
  deriveLlamaCppOpenClawMaxTokens,
  removeLlamaCppModelFromAppConfig,
} from './llamacppOpenClawBinding';

test('removeLlamaCppModelFromAppConfig removes deleted llama.cpp model and clears default selection', () => {
  const result = removeLlamaCppModelFromAppConfig({
    model: {
      defaultModel: 'Qwen3.5-0.8B-GGUF',
      defaultModelProvider: ProviderName.LlamaCpp,
    },
    providers: {
      [ProviderName.LlamaCpp]: {
        enabled: true,
        apiKey: 'no-key',
        baseUrl: 'http://127.0.0.1:8080/v1',
        apiFormat: 'openai',
        models: [
          { id: 'Qwen3.5-0.8B-GGUF', name: 'Qwen3.5-0.8B-GGUF', supportsImage: false },
          { id: 'qwen3:0.6b', name: 'qwen3:0.6b', supportsImage: false },
        ],
      },
    },
  }, 'Qwen3.5-0.8B-GGUF');

  expect(result.clearedDefaultModel).toBe(true);
  expect(result.config.model?.defaultModel).toBe('');
  expect(result.config.providers?.[ProviderName.LlamaCpp]?.models).toEqual([
    { id: 'qwen3:0.6b', name: 'qwen3:0.6b', supportsImage: false },
  ]);
});

test('buildLlamaCppRunningModelBinding uses runtime context length for OpenClaw contextWindow', () => {
  expect(buildLlamaCppRunningModelBinding({
    name: 'qwen-local',
    details: { context_length: 32768 },
    trained_context_length: 32768,
    runtime_context_length: 4096,
  })).toEqual({
    id: 'qwen-local',
    name: 'qwen-local',
    supportsImage: false,
    contextWindow: 4096,
    contextTokens: 4096,
    maxTokens: 1024,
  });
});

test('buildLlamaCppRunningModelBinding caps OpenClaw maxTokens below the runtime context window', () => {
  expect(deriveLlamaCppOpenClawMaxTokens(4096)).toBe(1024);
  expect(deriveLlamaCppOpenClawMaxTokens(8192)).toBe(2048);
  expect(deriveLlamaCppOpenClawMaxTokens(16384)).toBe(4096);
  expect(deriveLlamaCppOpenClawMaxTokens(32768)).toBe(4096);
});

test('buildLlamaCppRunningModelBinding returns null when runtime context length is unknown', () => {
  expect(buildLlamaCppRunningModelBinding({
    name: 'qwen-local',
    details: { context_length: 32768 },
    trained_context_length: 32768,
  })).toBeNull();
});
