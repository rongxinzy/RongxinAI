import { expect, test } from 'vitest';

import { DEFAULT_INFERENCE_OPTIONS, normalizeOptions } from './inferenceOptions';

test('uses the shared local inference defaults', () => {
  expect(DEFAULT_INFERENCE_OPTIONS).toEqual({
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    num_predict: 1024,
    repeat_penalty: 1.1,
    seed: -1,
    stop: '',
    min_p: 0.05,
    presence_penalty: 0,
    reasoning_preference: 'auto',
    cache_prompt: 'auto',
  });
});

test('normalizes default options for llama.cpp requests', () => {
  expect(normalizeOptions(DEFAULT_INFERENCE_OPTIONS)).toEqual({
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 1024,
    repeat_penalty: 1.1,
    min_p: 0.05,
    presence_penalty: 0,
  });
});

test('normalizes explicit overrides for request-only fields', () => {
  expect(
    normalizeOptions({
      ...DEFAULT_INFERENCE_OPTIONS,
      seed: 42,
      stop: '###, END',
      reasoning_preference: 'high',
      cache_prompt: 'disabled',
    }),
  ).toEqual({
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 1024,
    repeat_penalty: 1.1,
    min_p: 0.05,
    presence_penalty: 0,
    chat_template_kwargs: {
      enable_thinking: true,
    },
    cache_prompt: false,
    seed: 42,
    stop: ['###', 'END'],
  });
});

test('supports disabling thinking and forcing prompt cache', () => {
  expect(
    normalizeOptions({
      ...DEFAULT_INFERENCE_OPTIONS,
      reasoning_preference: 'low',
      cache_prompt: 'enabled',
    }),
  ).toEqual({
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 1024,
    repeat_penalty: 1.1,
    min_p: 0.05,
    presence_penalty: 0,
    chat_template_kwargs: {
      enable_thinking: false,
    },
    cache_prompt: true,
  });
});
