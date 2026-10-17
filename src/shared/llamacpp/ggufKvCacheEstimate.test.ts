import { describe, expect, test } from 'vitest';

import {
  estimateKvBytesPerTokenFromGgufShape,
  resolveGgufKvCacheShapeFromMetadata,
} from './ggufKvCacheEstimate';
import { LlamaCppKvCacheType } from './kvCacheTypes';

describe('ggufKvCacheEstimate', () => {
  test('derives KV bytes per token from llama-shaped metadata', () => {
    const metadata = new Map<string, unknown>([
      ['general.architecture', 'llama'],
      ['llama.block_count', 32],
      ['llama.attention.head_count_kv', 8],
      ['llama.attention.head_count', 32],
      ['llama.embedding_length', 4096],
    ]);
    const shape = resolveGgufKvCacheShapeFromMetadata(metadata);
    expect(shape).toEqual({ nLayer: 32, nHeadKv: 8, headDim: 128 });
    const bytes = estimateKvBytesPerTokenFromGgufShape({
      shape: shape!,
      cacheTypeK: LlamaCppKvCacheType.Q8_0,
      cacheTypeV: LlamaCppKvCacheType.Q8_0,
    });
    expect(bytes).toBeGreaterThan(30_000);
    expect(bytes).toBeLessThan(70_000);
  });
});
