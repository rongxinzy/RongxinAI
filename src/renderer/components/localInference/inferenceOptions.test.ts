import { expect, test } from 'vitest';

import {
  DEFAULT_INFERENCE_OPTIONS,
  getRecommendedInferenceOptions,
  isDefaultInferenceOptions,
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
    thinking_budget_tokens: 512,
  });

  expect(normalized).toEqual(expect.objectContaining({
    temperature: DEFAULT_INFERENCE_OPTIONS.temperature,
    top_p: DEFAULT_INFERENCE_OPTIONS.top_p,
    top_k: DEFAULT_INFERENCE_OPTIONS.top_k,
    num_predict: DEFAULT_INFERENCE_OPTIONS.num_predict,
    repeat_penalty: DEFAULT_INFERENCE_OPTIONS.repeat_penalty,
    min_p: 0.1,
    presence_penalty: 0.4,
    seed: 42,
    stop: ['###', 'END'],
    thinking_budget_tokens: 512,
  }));
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
    thinking_budget_tokens: 1024,
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
