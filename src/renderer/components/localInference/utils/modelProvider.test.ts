import { expect, test } from 'vitest';

import type { LlamaCppModel } from '../../../../shared/llamacpp';
import { ProviderName } from '../../../../shared/providers';
import { resolveLocalModelProvider } from './modelProvider';

function model(input: Partial<LlamaCppModel>): LlamaCppModel {
  return {
    name: 'unknown',
    ...input,
  };
}

test('local model provider favors GGUF family metadata', () => {
  expect(
    resolveLocalModelProvider(model({
      name: 'bartowski-DeepSeek-R1-Distill-Qwen-32B-GGUF',
      details: { family: 'qwen' },
    })),
  ).toBe(ProviderName.Qwen);
});

test('local model provider ignores a community publisher prefix', () => {
  expect(
    resolveLocalModelProvider(model({ name: 'bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF' })),
  ).toBe(ProviderName.DeepSeek);
});

test('local model provider can identify a model from its GGUF file name', () => {
  expect(
    resolveLocalModelProvider(model({
      name: 'local-model',
      path: 'D:\\models\\community\\Qwen3-32B-Q4_K_M.gguf',
    })),
  ).toBe(ProviderName.Qwen);
});

test('local model provider leaves unsupported model families unbranded', () => {
  expect(resolveLocalModelProvider(model({ name: 'Meta-Llama-3.1-8B-Instruct' }))).toBeNull();
});
