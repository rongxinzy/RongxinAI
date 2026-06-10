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
  DeviceUnavailable: 'device-unavailable',
  DeviceDetectionFailed: 'device-detection-failed',
  DeviceOutOfRange: 'device-out-of-range',
  GpuLayersFormat: 'gpu-layers-format',
  MainGpuUnavailable: 'main-gpu-unavailable',
  MainGpuDetectionFailed: 'main-gpu-detection-failed',
  MainGpuOutOfRange: 'main-gpu-out-of-range',
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
    runtimeDevices?: {
      success: boolean;
      devices?: Array<{ id?: string; name?: string; backend?: string }>;
    } | null;
  };

export const LlamaCppGpuDetectionState = {
  Unknown: 'unknown',
  Available: 'available',
  Unavailable: 'unavailable',
  DetectionFailed: 'detection-failed',
} as const;

export type LlamaCppGpuDetectionState =
  typeof LlamaCppGpuDetectionState[keyof typeof LlamaCppGpuDetectionState];

export const LLAMACPP_STRUCTURED_INTEGER_RANGES = {
  [LlamaCppStructuredServiceFieldKey.ModelsMax]: { min: 0, max: 256 },
  [LlamaCppStructuredServiceFieldKey.Parallel]: { min: 0, max: 256 },
  [LlamaCppStructuredServiceFieldKey.Timeout]: { min: 1, max: 86_400 },
  [LlamaCppStructuredServiceFieldKey.ThreadsHttp]: { min: 1, max: 512 },
  [LlamaCppStructuredServiceFieldKey.CacheReuse]: { min: 0, max: 65_536 },
  [LlamaCppStructuredServiceFieldKey.CacheRam]: { min: 0, max: 1_048_576 },
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
  const deviceAvailabilityError = validateIndexedDeviceField(input.device, input.runtimeDevices);
  if (deviceAvailabilityError) fieldErrors.device = deviceAvailabilityError;

  const gpuLayersError = validateGpuLayersField(input.gpuLayers);
  if (gpuLayersError) fieldErrors.gpuLayers = gpuLayersError;

  const mainGpuAvailabilityError = validateMainGpuField(input.mainGpu, input.runtimeDevices);
  if (mainGpuAvailabilityError) fieldErrors.mainGpu = mainGpuAvailabilityError;

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

export function getLlamaCppAcceleratorDevices(
  runtimeDevices?: {
    success: boolean;
    devices?: Array<{ id?: string; name?: string; backend?: string }>;
  } | null,
): Array<{ id: string; name?: string; backend?: string }> {
  if (!runtimeDevices?.success || !Array.isArray(runtimeDevices.devices)) return [];
  return runtimeDevices.devices.flatMap(device => {
    if (typeof device.id !== 'string' || device.id.trim().length === 0) return [];
    const backend = typeof device.backend === 'string' ? device.backend.trim().toLowerCase() : '';
    const id = device.id.trim();
    if (backend === 'cpu' || id.toUpperCase() === 'CPU') return [];
    return [{
      id,
      name: typeof device.name === 'string' ? device.name.trim() : undefined,
      backend: device.backend,
    }];
  });
}

export function getLlamaCppGpuDetectionState(
  runtimeDevices?: {
    success: boolean;
    devices?: Array<{ id?: string; name?: string; backend?: string }>;
  } | null,
): LlamaCppGpuDetectionState {
  if (runtimeDevices == null) return LlamaCppGpuDetectionState.Unknown;
  if (!runtimeDevices.success) return LlamaCppGpuDetectionState.DetectionFailed;
  return getLlamaCppAcceleratorDevices(runtimeDevices).length > 0
    ? LlamaCppGpuDetectionState.Available
    : LlamaCppGpuDetectionState.Unavailable;
}

function validateIndexedDeviceField(
  value: string | undefined,
  runtimeDevices?: StructuredConfigInput['runtimeDevices'],
): LlamaCppStructuredServiceFieldError | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const gpuDetectionState = getLlamaCppGpuDetectionState(runtimeDevices);
  if (gpuDetectionState === LlamaCppGpuDetectionState.DetectionFailed) {
    return { code: LlamaCppStructuredServiceFieldErrorCode.DeviceDetectionFailed };
  }
  if (gpuDetectionState === LlamaCppGpuDetectionState.Unknown) return null;
  const acceleratorDevices = getLlamaCppAcceleratorDevices(runtimeDevices);
  if (acceleratorDevices.length === 0) {
    return { code: LlamaCppStructuredServiceFieldErrorCode.DeviceUnavailable };
  }
  const parts = trimmed.split(',').map(part => Number.parseInt(part.trim(), 10));
  if (parts.some(index => !Number.isFinite(index) || index < 0 || index >= acceleratorDevices.length)) {
    return {
      code: LlamaCppStructuredServiceFieldErrorCode.DeviceOutOfRange,
      min: 0,
      max: acceleratorDevices.length - 1,
    };
  }
  return null;
}

function validateMainGpuField(
  value: string | undefined,
  runtimeDevices?: StructuredConfigInput['runtimeDevices'],
): LlamaCppStructuredServiceFieldError | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const gpuDetectionState = getLlamaCppGpuDetectionState(runtimeDevices);
  if (gpuDetectionState === LlamaCppGpuDetectionState.DetectionFailed) {
    return { code: LlamaCppStructuredServiceFieldErrorCode.MainGpuDetectionFailed };
  }
  if (gpuDetectionState === LlamaCppGpuDetectionState.Unknown) return null;
  const acceleratorDevices = getLlamaCppAcceleratorDevices(runtimeDevices);
  if (acceleratorDevices.length === 0) {
    return { code: LlamaCppStructuredServiceFieldErrorCode.MainGpuUnavailable };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= acceleratorDevices.length) {
    return {
      code: LlamaCppStructuredServiceFieldErrorCode.MainGpuOutOfRange,
      min: 0,
      max: acceleratorDevices.length - 1,
    };
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
