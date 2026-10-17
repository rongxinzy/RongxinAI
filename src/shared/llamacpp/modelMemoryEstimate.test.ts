import { expect, test } from 'vitest';

import { LlamaCppKvCacheType } from './kvCacheTypes';
import {
  estimateLlamaCppModelMemory,
  estimateRequiredLlamaCppModelVramMiB,
  LLAMACPP_MEMORY_ESTIMATE_MIB,
} from './modelMemoryEstimate';

test('estimates VRAM with KV cache scaling from context and quantization', () => {
  const modelSizeBytes = 4_000 * LLAMACPP_MEMORY_ESTIMATE_MIB;
  const f16 = estimateLlamaCppModelMemory({
    modelSizeBytes,
    contextSize: 32_768,
    cacheTypeK: LlamaCppKvCacheType.F16,
    cacheTypeV: LlamaCppKvCacheType.F16,
  });
  const q8 = estimateLlamaCppModelMemory({
    modelSizeBytes,
    contextSize: 32_768,
    cacheTypeK: LlamaCppKvCacheType.Q8_0,
    cacheTypeV: LlamaCppKvCacheType.Q8_0,
  });

  expect(f16).toBeDefined();
  expect(q8).toBeDefined();
  expect(q8!.estimatedVramMiB).toBeLessThan(f16!.estimatedVramMiB);
  expect(q8!.estimatedVramMiB).toBeGreaterThan(3_400);
});

test('estimateRequiredLlamaCppModelVramMiB grows with context length', () => {
  const modelSizeBytes = 8_000 * LLAMACPP_MEMORY_ESTIMATE_MIB;
  const smallCtx = estimateRequiredLlamaCppModelVramMiB({
    modelSizeBytes,
    contextSize: 4_096,
    cacheTypeK: LlamaCppKvCacheType.Q8_0,
    cacheTypeV: LlamaCppKvCacheType.Q8_0,
  });
  const largeCtx = estimateRequiredLlamaCppModelVramMiB({
    modelSizeBytes,
    contextSize: 32_768,
    cacheTypeK: LlamaCppKvCacheType.Q8_0,
    cacheTypeV: LlamaCppKvCacheType.Q8_0,
  });
  expect(largeCtx).toBeGreaterThan(smallCtx);
});

test('reserves runtime buffers and rejects missing model size', () => {
  expect(
    estimateLlamaCppModelMemory({
      modelSizeBytes: 1_000 * LLAMACPP_MEMORY_ESTIMATE_MIB,
      contextSize: 0,
    })?.estimatedVramMiB,
  ).toBeGreaterThan(900);
  expect(estimateLlamaCppModelMemory({ contextSize: 4_096 })).toBeUndefined();
});
