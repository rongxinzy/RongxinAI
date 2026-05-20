import { expect, test } from 'vitest';

import { ProviderName } from '../../shared/providers';
import { removeLlamaCppModelFromAppConfig } from './llamacppOpenClawBinding';

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
