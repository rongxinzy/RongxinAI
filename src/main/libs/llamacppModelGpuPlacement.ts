import fs from 'fs';

import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../../shared/hardware';
import {
  estimateRequiredLlamaCppModelVramMiB,
  LlamaCppMemoryPolicy,
  type LlamaCppModelLaunchInput,
  LlamaCppRuntimeBackend,
  type LlamaCppRuntimeCapabilities,
} from '../../shared/llamacpp';
import {
  LlamaCppModelLoadFailureReason,
  type LlamaCppModelLoadFailureReason as LlamaCppModelLoadFailureReasonType,
} from './llamacppModelLoadErrors';
import { readGgufBlockCount, readGgufKvBytesPerToken } from './ggufMetadata';
import { resolveLlamaCppDeviceSelection } from './llamacppServe';

export const LlamaCppModelGpuPlacementMode = {
  Cpu: 'cpu',
  Auto: 'auto',
  Explicit: 'explicit',
} as const;

export type LlamaCppModelGpuPlacementMode =
  (typeof LlamaCppModelGpuPlacementMode)[keyof typeof LlamaCppModelGpuPlacementMode];

export type LlamaCppModelGpuPlacementInput = {
  launchInput: LlamaCppModelLaunchInput;
  cacheTypeK?: string;
  cacheTypeV?: string;
  runtimeBackend?: LlamaCppRuntimeBackend;
  runtimeCapabilities?: Pick<
    LlamaCppRuntimeCapabilities,
    'success' | 'deviceProbeSucceeded' | 'devices' | 'gpuDeviceCount' | 'backendKinds'
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

  const nCpuMoeFailure = validateNCpuMoeAgainstBlockCount(input.launchInput);
  if (nCpuMoeFailure) return nCpuMoeFailure;

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
    input: withLlamaCppAutoGpuLayers(
      input.launchInput,
      selectedGpuIndexes,
      input.runtimeCapabilities?.devices ?? [],
    ),
  };
}

export { estimateRequiredLlamaCppModelVramMiB } from '../../shared/llamacpp/modelMemoryEstimate';

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
  const requiredMemoryMiB = estimateRequiredLlamaCppModelVramMiB(buildMemoryEstimateInput(input));
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

function buildMemoryEstimateInput(input: LlamaCppModelGpuPlacementInput) {
  const modelPath = input.launchInput.modelPath;
  const kvBytesPerToken =
    modelPath && fs.existsSync(modelPath)
      ? readGgufKvBytesPerToken(modelPath, input.cacheTypeK, input.cacheTypeV)
      : undefined;
  return {
    modelSizeBytes: input.modelSizeBytes,
    contextSize: input.launchInput.options?.ctxSize,
    cacheTypeK: input.cacheTypeK,
    cacheTypeV: input.cacheTypeV,
    ...(kvBytesPerToken ? { kvBytesPerToken } : {}),
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
  const requiredMemoryMiB = estimateRequiredLlamaCppModelVramMiB(buildMemoryEstimateInput(input));
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

/**
 * Rejects nCpuMoe values exceeding the model's layer count. Unreadable
 * block_count (non-GGUF or malformed metadata) passes through: llama.cpp
 * itself rejects impossible overrides at load time.
 */
function validateNCpuMoeAgainstBlockCount(
  launchInput: LlamaCppModelLaunchInput,
): Extract<LlamaCppModelGpuPlacementResult, { success: false }> | null {
  const nCpuMoe = launchInput.options?.nCpuMoe;
  if (nCpuMoe === undefined || !launchInput.modelPath) return null;

  const blockCount = readGgufBlockCount(launchInput.modelPath);
  if (blockCount === undefined || nCpuMoe <= blockCount) return null;

  return {
    success: false,
    reason: LlamaCppModelLoadFailureReason.ModelFileInvalid,
    detail: `The configured MoE CPU layer count (${nCpuMoe}) exceeds the model's layer count (${blockCount}).`,
  };
}

/**
 * Automatic GPU placement must keep llama.cpp's `--fit` enabled: fit (ON by
 * default, common/fit.cpp in llama-server b9244) keeps dense/attention
 * weights on GPU and moves overflow layers' expert tensors to CPU across
 * devices — which is exactly the behavior the auto path wants, for free.
 * fit ABORTS (common/fit.cpp:352-375) when the user set a numeric/all
 * n_gpu_layers (anything other than `auto`), tensor_split, split-mode `row`,
 * or any tensor_buft_override (which `--n-cpu-moe`, `--cpu-moe` and
 * `--override-tensor` produce). So this path must emit gpuLayers === 'auto'
 * and none of those keys; nCpuMoe is deliberately NOT an explicit GPU
 * placement trigger (device selection stays automatic, gpuLayers stays
 * 'auto') — when set, modelLaunchOptionsToPreset writes `n-cpu-moe` and
 * disables fit for that model, which is expected for a manual override.
 * The planner has no explicit per-device VRAM margin, so --fit-target is
 * deliberately not passed and fit's own default margin applies.
 */
function withLlamaCppAutoGpuLayers(
  input: LlamaCppModelLaunchInput,
  selectedGpuIndexes: number[],
  runtimeDevices: LlamaCppRuntimeCapabilities['devices'],
): LlamaCppModelLaunchInput {
  const device = resolveLlamaCppDeviceSelection(selectedGpuIndexes.join(','), runtimeDevices);
  return {
    ...input,
    options: {
      ...input.options,
      ...(device ? { device } : {}),
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
