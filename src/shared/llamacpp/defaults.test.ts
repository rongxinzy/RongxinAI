import { expect, test } from 'vitest';

import {
  applyLlamaCppChatDefaults,
  DEFAULT_LLAMACPP_CHAT_OPTIONS,
  DEFAULT_LLAMACPP_SERVICE_CONFIG,
} from './defaults';

test('llama.cpp service defaults are explicit and stable', () => {
  expect(DEFAULT_LLAMACPP_SERVICE_CONFIG).toEqual({
    host: '127.0.0.1',
    port: '8080',
    modelsMax: '0',
    timeout: '120',
    threadsHttp: '4',
    cacheReuse: '256',
    cacheRam: '8192',
    ctxSize: '4096',
    parallel: '1',
    batchSize: '512',
    ubatchSize: '512',
    gpuLayers: 'auto',
    threads: '-1',
    threadsBatch: '-1',
    mainGpu: '0',
  });
});

test('applyLlamaCppChatDefaults preserves the existing bounded local chat defaults', () => {
  expect(applyLlamaCppChatDefaults({
    model: 'qwen3',
    messages: [{ role: 'user', content: 'hello' }],
  }).options).toEqual(DEFAULT_LLAMACPP_CHAT_OPTIONS);
});

test('applyLlamaCppChatDefaults preserves request-level overrides', () => {
  expect(applyLlamaCppChatDefaults({
    model: 'qwen3',
    messages: [{ role: 'user', content: 'hello' }],
    options: {
      temperature: 0.3,
      max_tokens: 256,
      top_k: 20,
    },
  }).options).toEqual({
    ...DEFAULT_LLAMACPP_CHAT_OPTIONS,
    temperature: 0.3,
    max_tokens: 256,
    top_k: 20,
  });
});
