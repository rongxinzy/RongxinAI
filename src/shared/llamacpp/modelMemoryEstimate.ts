export const LLAMACPP_MEMORY_ESTIMATE_MIB = 1024 * 1024;

export type LlamaCppModelMemoryEstimate = {
  estimatedVramMiB: number;
  estimatedSystemMemoryMiB: number;
};

/**
 * Estimates GGUF memory requirements before the runtime reports actual usage.
 * The model weights may be split between VRAM and system memory, while the
 * context reservation covers the KV cache and runtime buffers.
 */
export function estimateLlamaCppModelMemory(input: {
  modelSizeBytes?: number;
  contextSize?: number;
}): LlamaCppModelMemoryEstimate | undefined {
  if (!input.modelSizeBytes || !Number.isFinite(input.modelSizeBytes) || input.modelSizeBytes <= 0) {
    return undefined;
  }

  const modelSizeMiB = input.modelSizeBytes / LLAMACPP_MEMORY_ESTIMATE_MIB;
  const contextMiB = Math.max(
    256,
    Math.round(Math.max(0, input.contextSize ?? 0) / 1024) * 256,
  );

  return {
    estimatedVramMiB: Math.round(modelSizeMiB * 0.82 + contextMiB),
    estimatedSystemMemoryMiB: Math.round(modelSizeMiB * 0.28 + contextMiB * 1.2),
  };
}
