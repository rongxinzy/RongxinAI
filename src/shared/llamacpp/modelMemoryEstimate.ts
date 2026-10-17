import { estimateLlamaCppKvBytesPerToken } from './kvCacheTypes';

export const LLAMACPP_MEMORY_ESTIMATE_MIB = 1024 * 1024;

export type LlamaCppModelMemoryEstimate = {
  estimatedVramMiB: number;
  estimatedSystemMemoryMiB: number;
};

export type LlamaCppModelMemoryEstimateInput = {
  modelSizeBytes?: number;
  contextSize?: number;
  cacheTypeK?: string;
  cacheTypeV?: string;
  /** When set, overrides heuristic KV/token (e.g. from GGUF metadata). */
  kvBytesPerToken?: number;
  /** Weight fraction likely resident on GPU when gpu-layers is auto (0–1). */
  gpuWeightFraction?: number;
};

/**
 * Estimates GGUF memory requirements before the runtime reports actual usage.
 * Weights may split between VRAM and system memory; KV cache scales with context
 * length and cache quantization instead of a flat per-1K-token constant.
 */
export function estimateLlamaCppModelMemory(
  input: LlamaCppModelMemoryEstimateInput,
): LlamaCppModelMemoryEstimate | undefined {
  if (
    !input.modelSizeBytes ||
    !Number.isFinite(input.modelSizeBytes) ||
    input.modelSizeBytes <= 0
  ) {
    return undefined;
  }

  const modelSizeMiB = input.modelSizeBytes / LLAMACPP_MEMORY_ESTIMATE_MIB;
  const contextTokens = Math.max(0, input.contextSize ?? 0);
  const kvBytesPerToken =
    input.kvBytesPerToken && input.kvBytesPerToken > 0
      ? input.kvBytesPerToken
      : estimateLlamaCppKvBytesPerToken({
          modelSizeBytes: input.modelSizeBytes,
          cacheTypeK: input.cacheTypeK,
          cacheTypeV: input.cacheTypeV,
        });
  const kvCacheMiB = (contextTokens * kvBytesPerToken) / LLAMACPP_MEMORY_ESTIMATE_MIB;
  const runtimeBufferMiB = Math.max(128, Math.round(modelSizeMiB * 0.03 + contextTokens / 512));
  const gpuWeightFraction = clampFraction(input.gpuWeightFraction ?? 0.82);

  const estimatedVramMiB = Math.ceil(
    modelSizeMiB * gpuWeightFraction + kvCacheMiB + runtimeBufferMiB,
  );
  const estimatedSystemMemoryMiB = Math.ceil(
    modelSizeMiB * (1 - gpuWeightFraction * 0.65) + kvCacheMiB * 0.15 + runtimeBufferMiB * 1.2,
  );

  return {
    estimatedVramMiB,
    estimatedSystemMemoryMiB,
  };
}

export function estimateRequiredLlamaCppModelVramMiB(
  input: LlamaCppModelMemoryEstimateInput,
): number {
  return estimateLlamaCppModelMemory(input)?.estimatedVramMiB ?? 0;
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0.82;
  return Math.max(0, Math.min(1, value));
}
