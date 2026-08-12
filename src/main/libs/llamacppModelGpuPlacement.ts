import type { NvidiaSmiSnapshot } from '../../shared/hardware';
import {
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
  Explicit: 'explicit',
  SingleGpu: 'single-gpu',
  MultiGpu: 'multi-gpu',
} as const;

export type LlamaCppModelGpuPlacementMode =
  (typeof LlamaCppModelGpuPlacementMode)[keyof typeof LlamaCppModelGpuPlacementMode];

export const LlamaCppModelGpuPlacementDefaults = {
  VramSafetyRatio: 0.8,
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
  modelSizeBytes?: number;
};

export type LlamaCppModelGpuPlacementResult =
  | {
      success: true;
      mode: LlamaCppModelGpuPlacementMode;
      input: LlamaCppModelLaunchInput;
      selectedGpuIndexes?: number[];
      requiredVramMiB?: number;
      availableVramMiB?: number;
    }
  | {
      success: false;
      reason: LlamaCppModelLoadFailureReasonType;
      detail?: string;
      requiredVramMiB?: number;
      availableVramMiB?: number;
    };

type GpuMemoryCandidate = {
  index: number;
  memoryFreeMiB: number;
};

const LlamaCppGpuBackendKind = {
  Cuda: 'cuda',
  Vulkan: 'vulkan',
  Metal: 'metal',
  Hip: 'hip',
  Rocm: 'rocm',
  Sycl: 'sycl',
  OpenVino: 'openvino',
} as const;

const LlamaCppModelGpuLayerSelection = {
  Auto: 'auto',
} as const;

/**
 * Applies a conservative GPU visibility plan before the actual llama.cpp load.
 * The real model load remains the final authority, because llama.cpp may still
 * fail while allocating weights, KV cache, or backend-specific buffers.
 */
export function planLlamaCppModelGpuPlacement(
  input: LlamaCppModelGpuPlacementInput,
): LlamaCppModelGpuPlacementResult {
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

  const candidates = getGpuMemoryCandidates(input.nvidiaSnapshot);
  if (candidates.length === 0) {
    return {
      success: false,
      reason: LlamaCppModelLoadFailureReason.GpuNotFound,
      detail: 'No GPU devices were detected for the selected GPU runtime.',
    };
  }

  const requiredVramMiB = estimateRequiredVramMiB(input);
  const sortedCandidates = [...candidates].sort(
    (left, right) => right.memoryFreeMiB - left.memoryFreeMiB,
  );
  const singleGpu = sortedCandidates.find(candidate =>
    hasEnoughVram(candidate.memoryFreeMiB, requiredVramMiB),
  );

  if (singleGpu) {
    return createGpuPlacementSuccess({
      mode: LlamaCppModelGpuPlacementMode.SingleGpu,
      launchInput: input.launchInput,
      selectedGpuIndexes: [singleGpu.index],
      requiredVramMiB,
      availableVramMiB: singleGpu.memoryFreeMiB,
    });
  }

  const selectedGpus: GpuMemoryCandidate[] = [];
  for (const candidate of sortedCandidates) {
    selectedGpus.push(candidate);
    const availableVramMiB = sumAvailableVramMiB(selectedGpus);
    if (hasEnoughVram(availableVramMiB, requiredVramMiB)) {
      return createGpuPlacementSuccess({
        mode: LlamaCppModelGpuPlacementMode.MultiGpu,
        launchInput: input.launchInput,
        selectedGpuIndexes: selectedGpus.map(gpu => gpu.index),
        requiredVramMiB,
        availableVramMiB,
      });
    }
  }

  return {
    success: false,
    reason: LlamaCppModelLoadFailureReason.VramInsufficient,
    detail: 'Available GPU memory is below the conservative model startup estimate.',
    requiredVramMiB,
    availableVramMiB: sumAvailableVramMiB(sortedCandidates),
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

  const capabilities = input.runtimeCapabilities;
  if (!capabilities) return false;
  if (capabilities.gpuDeviceCount > 0) return true;

  return capabilities.backendKinds.some(kind => isGpuBackendKind(kind));
}

function isGpuBackendKind(kind: string): boolean {
  const normalizedKind = kind.trim().toLowerCase();
  return (
    normalizedKind === LlamaCppGpuBackendKind.Cuda ||
    normalizedKind === LlamaCppGpuBackendKind.Vulkan ||
    normalizedKind === LlamaCppGpuBackendKind.Metal ||
    normalizedKind === LlamaCppGpuBackendKind.Hip ||
    normalizedKind === LlamaCppGpuBackendKind.Rocm ||
    normalizedKind === LlamaCppGpuBackendKind.Sycl ||
    normalizedKind === LlamaCppGpuBackendKind.OpenVino
  );
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

  if (!input.nvidiaSnapshot) {
    return {
      success: false,
      reason: LlamaCppModelLoadFailureReason.GpuProbeFailed,
      detail: 'GPU memory snapshot is unavailable.',
    };
  }

  if (!input.nvidiaSnapshot.available) {
    return {
      success: false,
      reason: LlamaCppModelLoadFailureReason.GpuProbeFailed,
      detail: input.nvidiaSnapshot.error ?? 'GPU memory snapshot is unavailable.',
    };
  }

  return null;
}

function getGpuMemoryCandidates(
  snapshot: NvidiaSmiSnapshot | null | undefined,
): GpuMemoryCandidate[] {
  if (!snapshot?.available) return [];

  return snapshot.gpus
    .filter(gpu => Number.isFinite(gpu.memoryFreeMiB) && (gpu.memoryFreeMiB ?? -1) >= 0)
    .map(gpu => ({
      index: gpu.index,
      memoryFreeMiB: gpu.memoryFreeMiB ?? 0,
    }));
}

function estimateRequiredVramMiB(input: LlamaCppModelGpuPlacementInput): number {
  return estimateRequiredLlamaCppModelVramMiB({
    modelSizeBytes: input.modelSizeBytes,
    ctxSize: input.launchInput.options?.ctxSize,
  });
}

function hasEnoughVram(availableVramMiB: number, requiredVramMiB: number): boolean {
  return requiredVramMiB <= availableVramMiB * LlamaCppModelGpuPlacementDefaults.VramSafetyRatio;
}

function createGpuPlacementSuccess(input: {
  mode:
    | typeof LlamaCppModelGpuPlacementMode.SingleGpu
    | typeof LlamaCppModelGpuPlacementMode.MultiGpu;
  launchInput: LlamaCppModelLaunchInput;
  selectedGpuIndexes: number[];
  requiredVramMiB: number;
  availableVramMiB: number;
}): Extract<LlamaCppModelGpuPlacementResult, { success: true }> {
  return {
    success: true,
    mode: input.mode,
    input: withGpuVisibility(input.launchInput, input.selectedGpuIndexes),
    selectedGpuIndexes: input.selectedGpuIndexes,
    requiredVramMiB: input.requiredVramMiB,
    availableVramMiB: input.availableVramMiB,
  };
}

function withGpuVisibility(
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

function sumAvailableVramMiB(gpus: GpuMemoryCandidate[]): number {
  return gpus.reduce((total, gpu) => total + gpu.memoryFreeMiB, 0);
}

function hasNonEmptyString(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
