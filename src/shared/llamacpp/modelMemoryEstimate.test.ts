import { expect, test } from 'vitest';

import {
  estimateLlamaCppModelMemory,
  LLAMACPP_MEMORY_ESTIMATE_MIB,
} from './modelMemoryEstimate';

test('estimates GGUF weight, context, and runtime buffer memory', () => {
  expect(
    estimateLlamaCppModelMemory({
      modelSizeBytes: 4_000 * LLAMACPP_MEMORY_ESTIMATE_MIB,
      contextSize: 4_096,
    }),
  ).toEqual({
    estimatedVramMiB: 4_304,
    estimatedSystemMemoryMiB: 2_349,
  });
});

test('reserves the minimum context buffer and rejects missing model size', () => {
  expect(
    estimateLlamaCppModelMemory({
      modelSizeBytes: 1_000 * LLAMACPP_MEMORY_ESTIMATE_MIB,
      contextSize: 0,
    }),
  ).toEqual({
    estimatedVramMiB: 1_076,
    estimatedSystemMemoryMiB: 587,
  });
  expect(estimateLlamaCppModelMemory({ contextSize: 4_096 })).toBeUndefined();
});
