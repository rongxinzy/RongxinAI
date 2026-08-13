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

  return {
    success: true,
    mode: isGpuRuntime(input)
      ? LlamaCppModelGpuPlacementMode.Auto
      : LlamaCppModelGpuPlacementMode.Cpu,
    input: withLlamaCppAutoGpuLayers(input.launchInput),
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

function withLlamaCppAutoGpuLayers(input: LlamaCppModelLaunchInput): LlamaCppModelLaunchInput {
  return {
    ...input,
    options: {
      ...input.options,
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
