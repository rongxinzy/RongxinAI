export const InferenceEdition = {
  Lite: 'lite',
  Cpu: 'cpu',
  Cuda: 'cuda',
} as const;

export type InferenceEdition = (typeof InferenceEdition)[keyof typeof InferenceEdition];

const INFERENCE_EDITIONS = new Set<string>(Object.values(InferenceEdition));

export function normalizeInferenceEdition(value: string | undefined | null): InferenceEdition {
  const normalized = value?.trim().toLowerCase();
  if (normalized && INFERENCE_EDITIONS.has(normalized)) {
    return normalized as InferenceEdition;
  }
  return InferenceEdition.Lite;
}

export function isLocalInferenceEnabledForEdition(edition: InferenceEdition): boolean {
  return edition === InferenceEdition.Cpu || edition === InferenceEdition.Cuda;
}

export function isBundledRuntimeEdition(edition: InferenceEdition): boolean {
  return isLocalInferenceEnabledForEdition(edition);
}

/** CUDA edition only ships on Windows/Linux x64; macOS ships cpu (Metal) only, lite is Windows-only. */
export function isCudaInferenceEditionSupported(
  edition: InferenceEdition,
  platform: NodeJS.Platform,
  arch: string,
): boolean {
  if (edition !== InferenceEdition.Cuda) return true;
  return (platform === 'win32' || platform === 'linux') && arch === 'x64';
}
