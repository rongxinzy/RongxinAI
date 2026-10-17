export const LlamaCppKvCacheType = {
  F32: 'f32',
  F16: 'f16',
  Bf16: 'bf16',
  Q8_0: 'q8_0',
  Q4_0: 'q4_0',
  Q4_1: 'q4_1',
  Iq4Nl: 'iq4_nl',
  Q5_0: 'q5_0',
  Q5_1: 'q5_1',
} as const;

export type LlamaCppKvCacheType = (typeof LlamaCppKvCacheType)[keyof typeof LlamaCppKvCacheType];

/** Relative KV footprint versus f16/f16 (16 BPV baseline in llama.cpp docs). */
const KV_TYPE_BPV_FACTOR: Record<LlamaCppKvCacheType, number> = {
  [LlamaCppKvCacheType.F32]: 2,
  [LlamaCppKvCacheType.F16]: 1,
  [LlamaCppKvCacheType.Bf16]: 1,
  [LlamaCppKvCacheType.Q8_0]: 8.5 / 16,
  [LlamaCppKvCacheType.Q4_0]: 4.75 / 16,
  [LlamaCppKvCacheType.Q4_1]: 5.5 / 16,
  [LlamaCppKvCacheType.Iq4Nl]: 4.75 / 16,
  [LlamaCppKvCacheType.Q5_0]: 5 / 16,
  [LlamaCppKvCacheType.Q5_1]: 6 / 16,
};

export function normalizeLlamaCppKvCacheType(value: string | undefined): LlamaCppKvCacheType {
  const normalized = value?.trim().toLowerCase();
  if (normalized && normalized in KV_TYPE_BPV_FACTOR) {
    return normalized as LlamaCppKvCacheType;
  }
  return LlamaCppKvCacheType.F16;
}

export function resolveLlamaCppKvCacheBpvFactor(
  cacheTypeK: string | undefined,
  cacheTypeV: string | undefined,
): number {
  const k = normalizeLlamaCppKvCacheType(cacheTypeK);
  const v = normalizeLlamaCppKvCacheType(cacheTypeV);
  return (KV_TYPE_BPV_FACTOR[k] + KV_TYPE_BPV_FACTOR[v]) / 2;
}

/**
 * Heuristic bytes/token for KV cache at f16/f16, scaled from GGUF size.
 * Calibrated so a ~4 GiB Q4 7–8B class model lands near 128 bytes/token.
 */
export function estimateLlamaCppKvBytesPerToken(input: {
  modelSizeBytes: number;
  cacheTypeK?: string;
  cacheTypeV?: string;
}): number {
  const modelGiB = input.modelSizeBytes / 1024 ** 3;
  const f16BytesPerToken = Math.max(
    48,
    Math.min(512, Math.round(128 * Math.max(0.5, modelGiB / 4))),
  );
  return Math.max(
    16,
    Math.round(
      f16BytesPerToken * resolveLlamaCppKvCacheBpvFactor(input.cacheTypeK, input.cacheTypeV),
    ),
  );
}
