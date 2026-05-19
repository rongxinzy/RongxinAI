import { expect, test } from 'vitest';

import {
  DEFAULT_INFERENCE_OPTIONS,
  getRecommendedInferenceOptions,
  isDefaultInferenceOptions,
  loadInferenceOptions,
  normalizeOptions,
  shouldApplyModelPreset,
} from './inferenceOptions';

test('normalizes inference options for llama.cpp requests', () => {
  const normalized = normalizeOptions({
    ...DEFAULT_INFERENCE_OPTIONS,
    seed: 42,
    stop: '###, END',
    min_p: 0.1,
    presence_penalty: 0.4,
    direct_answer_mode: 'enabled',
    cache_prompt: 'disabled',
  });

  expect(normalized).toEqual(expect.objectContaining({
    temperature: DEFAULT_INFERENCE_OPTIONS.temperature,
    top_p: DEFAULT_INFERENCE_OPTIONS.top_p,
    top_k: DEFAULT_INFERENCE_OPTIONS.top_k,
    max_tokens: DEFAULT_INFERENCE_OPTIONS.num_predict,
    repeat_penalty: DEFAULT_INFERENCE_OPTIONS.repeat_penalty,
    min_p: 0.1,
    presence_penalty: 0.4,
    cache_prompt: false,
    seed: 42,
    stop: ['###', 'END'],
  }));
  expect(normalized).not.toHaveProperty('thinking_forced_open');
  expect(normalized).not.toHaveProperty('reasoning_format');
  expect(normalized).not.toHaveProperty('chat_template_kwargs');
  expect(normalized).not.toHaveProperty('thinking_budget_tokens');
});

test('loading inference options clears deprecated thinking-specific settings', () => {
  const storage = new Map<string, string>();
  const originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    },
  });

  storage.set('lobsterai:llamacpp-inference-options', JSON.stringify({
    reasoning_format: 'none',
    thinking_forced_open: 'disabled',
    thinking_budget_tokens: 0,
    direct_answer_mode: 'enabled',
  }));

  const loaded = loadInferenceOptions();
  expect(loaded.reasoning_format).toBe('auto');
  expect(loaded.thinking_forced_open).toBe('auto');
  expect(loaded.thinking_budget_tokens).toBe(-1);
  expect(loaded.direct_answer_mode).toBe('enabled');

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
});

test('returns a Qwen preset with a shorter thinking budget', () => {
  const recommended = getRecommendedInferenceOptions('Qwen3.5-0.8B-GGUF');

  expect(recommended).toEqual(expect.objectContaining({
    temperature: 0.3,
    top_p: 0.8,
    top_k: 20,
    repeat_penalty: 1.05,
    min_p: 0.05,
    presence_penalty: 0.6,
    reasoning_format: 'auto',
    thinking_forced_open: 'auto',
  }));
});

test('detects when a preset can be auto-applied', () => {
  expect(isDefaultInferenceOptions(DEFAULT_INFERENCE_OPTIONS)).toBe(true);
  expect(shouldApplyModelPreset(DEFAULT_INFERENCE_OPTIONS)).toBe(true);
  expect(shouldApplyModelPreset({
    ...DEFAULT_INFERENCE_OPTIONS,
    temperature: 0.2,
  })).toBe(false);
});
