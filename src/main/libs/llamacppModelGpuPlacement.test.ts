import { describe, expect, test } from 'vitest';

import type { NvidiaSmiSnapshot } from '../../shared/hardware';
import {
  type LlamaCppModelLaunchInput,
  LlamaCppRuntimeBackend,
} from '../../shared/llamacpp';
import {
  estimateRequiredLlamaCppModelVramMiB,
  LlamaCppModelGpuPlacementDefaults,
  LlamaCppModelGpuPlacementMode,
  planLlamaCppModelGpuPlacement,
} from './llamacppModelGpuPlacement';
import { LlamaCppModelLoadFailureReason } from './llamacppModelLoadErrors';

describe('llamacppModelGpuPlacement', () => {
  test('keeps cpu runtime on the normal cpu path when no gpu is detected', () => {
    const launchInput = modelLaunchInput();
    const result = planLlamaCppModelGpuPlacement({
      launchInput,
      runtimeBackend: LlamaCppRuntimeBackend.Cpu,
      runtimeCapabilities: gpuCapabilities({ gpuDeviceCount: 0, backendKinds: ['cpu'] }),
      nvidiaSnapshot: unavailableSnapshot('nvidia-smi not found'),
      modelSizeBytes: gib(7),
    });

    expect(result).toEqual({
      success: true,
      mode: LlamaCppModelGpuPlacementMode.Cpu,
      input: launchInput,
    });
  });

  test('preserves explicit gpu placement options', () => {
    const launchInput = modelLaunchInput({
      options: {
        ctxSize: 4096,
        device: '1',
        mainGpu: 1,
        splitMode: 'layer',
        tensorSplit: '1,1',
      },
    });

    const result = planLlamaCppModelGpuPlacement({
      launchInput,
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities({ gpuDeviceCount: 2 }),
      nvidiaSnapshot: availableSnapshot([
        { index: 0, memoryFreeMiB: 24_000 },
        { index: 1, memoryFreeMiB: 24_000 },
      ]),
      modelSizeBytes: gib(10),
    });

    expect(result).toEqual({
      success: true,
      mode: LlamaCppModelGpuPlacementMode.Explicit,
      input: launchInput,
    });
  });

  test('reports gpu probe failure for a gpu runtime when device probing fails', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput(),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities({ deviceProbeSucceeded: false, gpuDeviceCount: 0 }),
      nvidiaSnapshot: unavailableSnapshot('nvidia-smi timed out'),
      modelSizeBytes: gib(7),
    });

    expect(result).toMatchObject({
      success: false,
      reason: LlamaCppModelLoadFailureReason.GpuProbeFailed,
    });
  });

  test('reports gpu not found when a gpu runtime probes successfully but finds no gpu', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput(),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities({ gpuDeviceCount: 0 }),
      nvidiaSnapshot: availableSnapshot([]),
      modelSizeBytes: gib(7),
    });

    expect(result).toMatchObject({
      success: false,
      reason: LlamaCppModelLoadFailureReason.GpuNotFound,
    });
  });

  test('chooses the largest single gpu when it satisfies the conservative estimate', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({ options: { ctxSize: 4096 } }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities({ gpuDeviceCount: 2 }),
      nvidiaSnapshot: availableSnapshot([
        { index: 0, memoryFreeMiB: 12_000 },
        { index: 1, memoryFreeMiB: 24_000 },
      ]),
      modelSizeBytes: gib(7),
    });

    expect(result).toMatchObject({
      success: true,
      mode: LlamaCppModelGpuPlacementMode.SingleGpu,
      selectedGpuIndexes: [1],
      availableVramMiB: 24_000,
    });
    expect(result.success && result.input.options?.device).toBe('1');
    expect(result.success && result.input.options?.gpuLayers).toBe('auto');
  });

  test('chooses the minimal multi-gpu set when one gpu is not enough', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({ options: { ctxSize: 4096 } }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities({ gpuDeviceCount: 3 }),
      nvidiaSnapshot: availableSnapshot([
        { index: 0, memoryFreeMiB: 12_000 },
        { index: 1, memoryFreeMiB: 11_000 },
        { index: 2, memoryFreeMiB: 5_000 },
      ]),
      modelSizeBytes: gib(14),
    });

    expect(result).toMatchObject({
      success: true,
      mode: LlamaCppModelGpuPlacementMode.MultiGpu,
      selectedGpuIndexes: [0, 1],
      availableVramMiB: 23_000,
    });
    expect(result.success && result.input.options?.device).toBe('0,1');
    expect(result.success && result.input.options?.gpuLayers).toBe('auto');
  });

  test('reports insufficient vram when all visible gpus are below the estimate', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({ options: { ctxSize: 8192 } }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities({ gpuDeviceCount: 2 }),
      nvidiaSnapshot: availableSnapshot([
        { index: 0, memoryFreeMiB: 8_000 },
        { index: 1, memoryFreeMiB: 8_000 },
      ]),
      modelSizeBytes: gib(14),
    });

    expect(result).toMatchObject({
      success: false,
      reason: LlamaCppModelLoadFailureReason.VramInsufficient,
      availableVramMiB: 16_000,
    });
  });

  test('preserves existing gpu layer settings when applying device visibility', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({ options: { ctxSize: 4096, gpuLayers: 32 } }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities({ gpuDeviceCount: 1 }),
      nvidiaSnapshot: availableSnapshot([{ index: 0, memoryFreeMiB: 24_000 }]),
      modelSizeBytes: gib(7),
    });

    expect(result.success && result.input.options?.device).toBe('0');
    expect(result.success && result.input.options?.gpuLayers).toBe(32);
  });

  test('estimates required vram from model size and context buffer', () => {
    expect(estimateRequiredLlamaCppModelVramMiB({
      modelSizeBytes: gib(10),
      ctxSize: 4096,
    })).toBe(
      Math.ceil(10 * 1024 * LlamaCppModelGpuPlacementDefaults.ModelSizeMultiplier) + 4 * 256,
    );
  });
});

function modelLaunchInput(input: Partial<LlamaCppModelLaunchInput> = {}): LlamaCppModelLaunchInput {
  return {
    model: input.model ?? 'qwen.gguf',
    modelPath: input.modelPath,
    options: input.options,
  };
}

function gpuCapabilities(input: {
  success?: boolean;
  deviceProbeSucceeded?: boolean;
  gpuDeviceCount?: number;
  backendKinds?: string[];
}) {
  return {
    success: input.success ?? true,
    deviceProbeSucceeded: input.deviceProbeSucceeded ?? true,
    gpuDeviceCount: input.gpuDeviceCount ?? 1,
    backendKinds: input.backendKinds ?? ['cuda'],
  };
}

function availableSnapshot(gpus: Array<{ index: number; memoryFreeMiB: number }>): NvidiaSmiSnapshot {
  return {
    source: 'nvidia-smi',
    available: true,
    checkedAt: '2026-07-13T00:00:00.000Z',
    gpus: gpus.map(gpu => ({
      index: gpu.index,
      name: `GPU ${gpu.index}`,
      memoryTotalMiB: gpu.memoryFreeMiB,
      memoryFreeMiB: gpu.memoryFreeMiB,
    })),
  };
}

function unavailableSnapshot(error: string): NvidiaSmiSnapshot {
  return {
    source: 'nvidia-smi',
    available: false,
    checkedAt: '2026-07-13T00:00:00.000Z',
    gpus: [],
    error,
  };
}

function gib(value: number): number {
  return value * 1024 * 1024 * 1024;
}
