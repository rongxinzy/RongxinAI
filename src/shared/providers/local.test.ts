import { expect, test } from 'vitest';

import { isLocalModelRef, isLocalProviderName } from './local';

test('isLocalProviderName recognizes local providers', () => {
  expect(isLocalProviderName('llamacpp')).toBe(true);
  expect(isLocalProviderName('ollama')).toBe(true);
  expect(isLocalProviderName('openai')).toBe(false);
});

test('isLocalModelRef recognizes provider-qualified local refs', () => {
  expect(isLocalModelRef('llamacpp/qwen-local')).toBe(true);
  expect(isLocalModelRef('ollama/qwen3:8b')).toBe(true);
  expect(isLocalModelRef('openai/gpt-5')).toBe(false);
  expect(isLocalModelRef('qwen-local')).toBe(false);
});
