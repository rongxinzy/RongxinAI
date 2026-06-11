import type { LlamaCppServiceConfig } from './types';

export const LlamaCppStructuredServiceFieldKey = {
  ModelsMax: 'modelsMax',
  Device: 'device',
  Parallel: 'parallel',
  Timeout: 'timeout',
  ThreadsHttp: 'threadsHttp',
  CacheReuse: 'cacheReuse',
  CacheRam: 'cacheRam',
  CtxSize: 'ctxSize',
  TensorSplit: 'tensorSplit',
  MainGpu: 'mainGpu',
  BatchSize: 'batchSize',
  UbatchSize: 'ubatchSize',
  Threads: 'threads',
  ThreadsBatch: 'threadsBatch',
  GpuLayers: 'gpuLayers',
} as const;

export type LlamaCppStructuredServiceFieldKey =
  typeof LlamaCppStructuredServiceFieldKey[keyof typeof LlamaCppStructuredServiceFieldKey];

export const LLAMACPP_STRUCTURED_SERVICE_FIELD_KEYS = [
  LlamaCppStructuredServiceFieldKey.ModelsMax,
  LlamaCppStructuredServiceFieldKey.Device,
  LlamaCppStructuredServiceFieldKey.Parallel,
  LlamaCppStructuredServiceFieldKey.Timeout,
  LlamaCppStructuredServiceFieldKey.ThreadsHttp,
  LlamaCppStructuredServiceFieldKey.CacheReuse,
  LlamaCppStructuredServiceFieldKey.CacheRam,
  LlamaCppStructuredServiceFieldKey.CtxSize,
  LlamaCppStructuredServiceFieldKey.TensorSplit,
  LlamaCppStructuredServiceFieldKey.MainGpu,
  LlamaCppStructuredServiceFieldKey.BatchSize,
  LlamaCppStructuredServiceFieldKey.UbatchSize,
  LlamaCppStructuredServiceFieldKey.Threads,
  LlamaCppStructuredServiceFieldKey.ThreadsBatch,
  LlamaCppStructuredServiceFieldKey.GpuLayers,
] as const satisfies readonly LlamaCppStructuredServiceFieldKey[];

export const LlamaCppStructuredServiceFieldErrorCode = {
  IntegerRange: 'integer-range',
  DeviceFormat: 'device-format',
  GpuLayersFormat: 'gpu-layers-format',
  TensorSplitFormat: 'tensor-split-format',
  TensorSplitRequiresMode: 'tensor-split-requires-mode',
} as const;

export type LlamaCppStructuredServiceFieldErrorCode =
  typeof LlamaCppStructuredServiceFieldErrorCode[keyof typeof LlamaCppStructuredServiceFieldErrorCode];

export type LlamaCppStructuredServiceFieldError = {
  code: LlamaCppStructuredServiceFieldErrorCode;
  min?: number;
  max?: number;
};

type StructuredConfigInput =
  Partial<Record<LlamaCppStructuredServiceFieldKey, string>> & {
    splitMode?: LlamaCppServiceConfig['splitMode'] | string;
  };

export const LLAMACPP_STRUCTURED_INTEGER_RANGES = {
  [LlamaCppStructuredServiceFieldKey.ModelsMax]: { min: 0, max: 256 },
  [LlamaCppStructuredServiceFieldKey.Parallel]: { min: 0, max: 256 },
  [LlamaCppStructuredServiceFieldKey.Timeout]: { min: 1, max: 86_400 },
  [LlamaCppStructuredServiceFieldKey.ThreadsHttp]: { min: 1, max: 512 },
  [LlamaCppStructuredServiceFieldKey.CacheReuse]: { min: 1, max: 4_096 },
  [LlamaCppStructuredServiceFieldKey.CacheRam]: { min: -1, max: 65_536 },
  [LlamaCppStructuredServiceFieldKey.CtxSize]: { min: 128, max: 1_048_576 },
  [LlamaCppStructuredServiceFieldKey.MainGpu]: { min: 0, max: 256 },
  [LlamaCppStructuredServiceFieldKey.BatchSize]: { min: 1, max: 65_536 },
  [LlamaCppStructuredServiceFieldKey.UbatchSize]: { min: 1, max: 65_536 },
  [LlamaCppStructuredServiceFieldKey.Threads]: { min: -1, max: 512 },
  [LlamaCppStructuredServiceFieldKey.ThreadsBatch]: { min: -1, max: 512 },
} as const satisfies Partial<Record<LlamaCppStructuredServiceFieldKey, { min: number; max: number }>>;

export const LLAMACPP_GPU_LAYERS_MAX = 4_096;

export function validateLlamaCppStructuredServiceConfig(
  input: StructuredConfigInput,
): {
  hasErrors: boolean;
  fieldErrors: Partial<Record<LlamaCppStructuredServiceFieldKey, LlamaCppStructuredServiceFieldError>>;
} {
  const fieldErrors: Partial<
    Record<LlamaCppStructuredServiceFieldKey, LlamaCppStructuredServiceFieldError>
  > = {};

  for (const field of Object.keys(LLAMACPP_STRUCTURED_INTEGER_RANGES) as Array<keyof typeof LLAMACPP_STRUCTURED_INTEGER_RANGES>) {
    const error = validateIntegerField(input[field], LLAMACPP_STRUCTURED_INTEGER_RANGES[field]);
    if (error) fieldErrors[field] = error;
  }

  const deviceError = validateDeviceField(input.device);
  if (deviceError) fieldErrors.device = deviceError;

  const gpuLayersError = validateGpuLayersField(input.gpuLayers);
  if (gpuLayersError) fieldErrors.gpuLayers = gpuLayersError;

  const tensorSplitError = validateTensorSplitField(input.tensorSplit, input.splitMode);
  if (tensorSplitError) fieldErrors.tensorSplit = tensorSplitError;

  return {
    hasErrors: Object.keys(fieldErrors).length > 0,
    fieldErrors,
  };
}

function validateIntegerField(
  value: string | undefined,
  range: { min: number; max: number },
): LlamaCppStructuredServiceFieldError | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^-?\d+$/.test(trimmed)) {
    return {
      code: LlamaCppStructuredServiceFieldErrorCode.IntegerRange,
      min: range.min,
      max: range.max,
    };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < range.min || parsed > range.max) {
    return {
      code: LlamaCppStructuredServiceFieldErrorCode.IntegerRange,
      min: range.min,
      max: range.max,
    };
  }
  return null;
}

function validateDeviceField(
  value: string | undefined,
): LlamaCppStructuredServiceFieldError | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^\d+(?:\s*,\s*\d+)*$/.test(trimmed)) {
    return { code: LlamaCppStructuredServiceFieldErrorCode.DeviceFormat };
  }
  return null;
}

function validateGpuLayersField(
  value: string | undefined,
): LlamaCppStructuredServiceFieldError | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed === 'auto' || trimmed === 'all') return null;
  if (!/^-?\d+$/.test(trimmed)) {
    return { code: LlamaCppStructuredServiceFieldErrorCode.GpuLayersFormat };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > LLAMACPP_GPU_LAYERS_MAX) {
    return { code: LlamaCppStructuredServiceFieldErrorCode.GpuLayersFormat };
  }
  return null;
}

function validateTensorSplitField(
  value: string | undefined,
  splitMode?: string,
): LlamaCppStructuredServiceFieldError | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (splitMode !== 'tensor') {
    return { code: LlamaCppStructuredServiceFieldErrorCode.TensorSplitRequiresMode };
  }
  const parts = trimmed.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { code: LlamaCppStructuredServiceFieldErrorCode.TensorSplitFormat };
  }
  for (const part of parts) {
    if (!/^\d+(?:\.\d+)?$/.test(part)) {
      return { code: LlamaCppStructuredServiceFieldErrorCode.TensorSplitFormat };
    }
    const parsed = Number(part);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1024) {
      return { code: LlamaCppStructuredServiceFieldErrorCode.TensorSplitFormat };
    }
  }
  return null;
}
