import { expect, test } from 'vitest';

import { ProviderName } from '../../shared/providers';
import {
  buildLocalThinkingRequestParams,
  type DirectChatRequestOptions,
} from './localThinkingRequest';

test('sends a boolean thinking kwarg for llama.cpp', () => {
  expect(buildLocalThinkingRequestParams(ProviderName.LlamaCpp, true)).toEqual({
    chat_template_kwargs: { enable_thinking: true },
  });
  expect(buildLocalThinkingRequestParams(ProviderName.LlamaCpp, false)).toEqual({
    chat_template_kwargs: { enable_thinking: false },
  });
});

test('omits the kwarg for unsupported providers and unknown capability', () => {
  expect(buildLocalThinkingRequestParams(ProviderName.Ollama, true)).toEqual({});
  expect(buildLocalThinkingRequestParams(ProviderName.LlamaCpp, undefined)).toEqual({});
});

test('keeps model selection and thinking state in one direct chat options object', () => {
  const options: DirectChatRequestOptions = {
    modelId: 'qwen-local',
    localThinkingEnabled: true,
  };

  expect(options).toEqual({
    modelId: 'qwen-local',
    localThinkingEnabled: true,
  });
});
