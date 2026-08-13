import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../../shared/hardware';
import {
  LlamaCppMemoryPolicy,
  type LlamaCppModelLaunchInput,
  LlamaCppRuntimeBackend,
  type LlamaCppRuntimeCapabilities,
} from '../../shared/llamacpp';
import {
  LlamaCppModelLoadFailureReason,
  type LlamaCppModelLoadFailureReason as LlamaCppModelLoadFailureReasonType,
} from './llamacppModelLoadErrors';

export const LlamaCppModelGpuPlacementMode = {
  Cpu: 'cpu',
  Auto: 'auto',
  Explicit: 'explicit',
} as const;

export type LlamaCppModelGpuPlacementMode =
  (typeof LlamaCppModelGpuPlacementMode)[keyof typeof LlamaCppModelGpuPlacementMode];

export const LlamaCppModelGpuPlacementDefaults = {
  ModelSizeMultiplier: 1.2,
  ContextBufferPer1024TokensMiB: 256,
} as const;

export type LlamaCppModelGpuPlacementInput = {
  launchInput: LlamaCppModelLaunchInput;
  runtimeBackend?: LlamaCppRuntimeBackend;
  runtimeCapabilities?: Pick<
    LlamaCppRuntimeCapabilities,
    'success' | 'deviceProbeSucceeded' | 'gpuDeviceCount' | 'backendKinds'
  > | null;
  nvidiaSnapshot?: NvidiaSmiSnapshot | null;
  systemMemorySnapshot?: SystemMemorySnapshot | null;
  memoryPolicy?: LlamaCppMemoryPolicy;
  memoryBudgetPercent?: number;
  modelSizeBytes?: number;
};

export type LlamaCppModelGpuPlacementResult =
  | {
      success: true;
      mode: LlamaCppModelGpuPlacementMode;
      input: LlamaCppModelLaunchInput;
    }
  | {
      success: false;
      reason: LlamaCppModelLoadFailureReasonType;
      detail?: string;
      requiredMemoryMiB?: number;
      availableMemoryMiB?: number;
    };

const LlamaCppModelGpuLayerSelection = {
  Auto: 'auto',
} as const;

/**
 * Lets llama.cpp select the GPU layer split. Manual memory policy is only a
 * load-admission check and does not try to infer architecture-specific layers.
 */
export function planLlamaCppModelGpuPlacement(
  input: LlamaCppModelGpuPlacementInput,
): LlamaCppModelGpuPlacementResult {
  const memoryBudgetFailure = validateManualMemoryBudget(input);
  if (memoryBudgetFailure) return memoryBudgetFailure;

  if (hasExplicitGpuPlacement(input.launchInput)) {
    return {
      success: true,
      mode: LlamaCppModelGpuPlacementMode.Explicit,
      input: input.launchInput,
    };
  }

  if (!isGpuRuntime(input)) {
    return {
      success: true,
      mode: LlamaCppModelGpuPlacementMode.Cpu,
      input: input.launchInput,
    };
  }

  const probeFailure = getGpuProbeFailure(input);
  if (probeFailure) return probeFailure;

  const selectedGpuIndexes = selectGpuIndexes(input);
  return {
    success: true,
    mode: LlamaCppModelGpuPlacementMode.Auto,
    input: withLlamaCppAutoGpuLayers(input.launchInput, selectedGpuIndexes),
  };
}

export function estimateRequiredLlamaCppModelVramMiB(input: {
  modelSizeBytes?: number;
  ctxSize?: number;
}): number {
  const modelSizeMiB =
    input.modelSizeBytes && input.modelSizeBytes > 0
      ? Math.ceil(input.modelSizeBytes / 1024 / 1024)
      : 0;
  const contextBufferMiB =
    input.ctxSize && input.ctxSize > 0
      ? Math.ceil(input.ctxSize / 1024) *
        LlamaCppModelGpuPlacementDefaults.ContextBufferPer1024TokensMiB
      : 0;

  return Math.ceil(
    modelSizeMiB * LlamaCppModelGpuPlacementDefaults.ModelSizeMultiplier + contextBufferMiB,
  );
}

function validateManualMemoryBudget(
  input: LlamaCppModelGpuPlacementInput,
): Extract<LlamaCppModelGpuPlacementResult, { success: false }> | null {
  if (input.memoryPolicy !== LlamaCppMemoryPolicy.Manual) return null;

  const systemMemory = input.systemMemorySnapshot;
  if (!systemMemory?.available) {
    return {
      success: false,
      reason: LlamaCppModelLoadFailureReason.SystemMemoryInsufficient,
      detail: 'System memory information is unavailable for the manual memory budget.',
    };
  }

  const budgetPercent = input.memoryBudgetPercent ?? 50;
  const budgetMiB = Math.floor(systemMemory.totalMemoryMiB * (budgetPercent / 100));
  const availableSystemMemoryMiB = Math.min(budgetMiB, systemMemory.freeMemoryMiB);
  const availableMemoryMiB = availableSystemMemoryMiB + sumAvailableVramMiB(input.nvidiaSnapshot);
  const requiredMemoryMiB = estimateRequiredLlamaCppModelVramMiB({
    modelSizeBytes: input.modelSizeBytes,
    ctxSize: input.launchInput.options?.ctxSize,
  });
  if (requiredMemoryMiB <= availableMemoryMiB) return null;

  return {
    success: false,
    reason: LlamaCppModelLoadFailureReason.SystemMemoryInsufficient,
    detail:
      'The model startup estimate exceeds the configured system-memory budget plus free VRAM.',
    requiredMemoryMiB,
    availableMemoryMiB,
  };
}

function hasExplicitGpuPlacement(input: LlamaCppModelLaunchInput): boolean {
  const options = input.options;
  if (!options) return false;
  return (
    hasNonEmptyString(options.device) ||
    options.mainGpu !== undefined ||
    options.splitMode !== undefined ||
    hasNonEmptyString(options.tensorSplit)
  );
}

function isGpuRuntime(input: LlamaCppModelGpuPlacementInput): boolean {
  if (input.runtimeBackend === LlamaCppRuntimeBackend.Cpu) return false;
  if (input.runtimeBackend === LlamaCppRuntimeBackend.Cuda) return true;
  return Boolean(input.runtimeCapabilities?.gpuDeviceCount);
}

function getGpuProbeFailure(
  input: LlamaCppModelGpuPlacementInput,
): Extract<LlamaCppModelGpuPlacementResult, { success: false }> | null {
  if (input.runtimeCapabilities?.deviceProbeSucceeded === false) {
    return {
      success: false,
      reason: LlamaCppModelLoadFailureReason.GpuProbeFailed,
      detail: input.nvidiaSnapshot?.error ?? 'The llama.cpp runtime failed to probe GPU devices.',
    };
  }

  if (
    input.runtimeCapabilities?.deviceProbeSucceeded === true &&
    input.runtimeCapabilities.gpuDeviceCount === 0
  ) {
    return {
      success: false,
      reason: LlamaCppModelLoadFailureReason.GpuNotFound,
      detail: 'The selected GPU runtime reported no available GPU devices.',
    };
  }

  if (!input.nvidiaSnapshot?.available) {
    return {
      success: false,
      reason: LlamaCppModelLoadFailureReason.GpuProbeFailed,
      detail: input.nvidiaSnapshot?.error ?? 'GPU memory snapshot is unavailable.',
    };
  }

  if (input.nvidiaSnapshot.gpus.length === 0) {
    return {
      success: false,
      reason: LlamaCppModelLoadFailureReason.GpuNotFound,
      detail: 'No GPU devices were detected for the selected GPU runtime.',
    };
  }

  return null;
}

function selectGpuIndexes(input: LlamaCppModelGpuPlacementInput): number[] {
  const candidates = (input.nvidiaSnapshot?.gpus ?? [])
    .filter(gpu => Number.isFinite(gpu.memoryFreeMiB) && (gpu.memoryFreeMiB ?? -1) >= 0)
    .sort((left, right) => (right.memoryFreeMiB ?? 0) - (left.memoryFreeMiB ?? 0));
  const requiredMemoryMiB = estimateRequiredLlamaCppModelVramMiB({
    modelSizeBytes: input.modelSizeBytes,
    ctxSize: input.launchInput.options?.ctxSize,
  });
  const selected: number[] = [];
  let availableMemoryMiB = 0;

  for (const candidate of candidates) {
    selected.push(candidate.index);
    availableMemoryMiB += candidate.memoryFreeMiB ?? 0;
    if (availableMemoryMiB >= requiredMemoryMiB) return selected;
  }

  // Keep every available GPU visible when VRAM alone cannot hold the model.
  // llama.cpp can then choose a partial layer offload and use system memory.
  return selected;
}

function withLlamaCppAutoGpuLayers(
  input: LlamaCppModelLaunchInput,
  selectedGpuIndexes: number[],
): LlamaCppModelLaunchInput {
  return {
    ...input,
    options: {
      ...input.options,
      device: selectedGpuIndexes.join(','),
      gpuLayers: input.options?.gpuLayers ?? LlamaCppModelGpuLayerSelection.Auto,
    },
  };
}

function sumAvailableVramMiB(snapshot: NvidiaSmiSnapshot | null | undefined): number {
  if (!snapshot?.available) return 0;
  return snapshot.gpus.reduce((total, gpu) => total + (gpu.memoryFreeMiB ?? 0), 0);
}

function hasNonEmptyString(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
