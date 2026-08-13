import { describe, expect, test } from 'vitest';

import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../../shared/hardware';
import {
  LlamaCppMemoryPolicy,
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
  test('lets llama.cpp automatically select GPU layers even when the complete model exceeds VRAM', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({ options: { ctxSize: 8192 } }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities(),
      nvidiaSnapshot: availableSnapshot(8_000),
      modelSizeBytes: gib(14),
    });

    expect(result).toMatchObject({
      success: true,
      mode: LlamaCppModelGpuPlacementMode.Auto,
    });
    expect(result.success && result.input.options?.gpuLayers).toBe('auto');
    expect(result.success && result.input.options?.device).toBe('0');
  });

  test('keeps a CPU runtime launch input unchanged', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput(),
      runtimeBackend: LlamaCppRuntimeBackend.Cpu,
      modelSizeBytes: gib(7),
    });

    expect(result).toMatchObject({ success: true, mode: LlamaCppModelGpuPlacementMode.Cpu });
    expect(result.success && result.input).toEqual(modelLaunchInput({ model: 'qwen.gguf' }));
  });

  test('does not alter explicit GPU placement', () => {
    const launchInput = modelLaunchInput({
      options: { device: '1', gpuLayers: 32, splitMode: 'layer' },
    });
    const result = planLlamaCppModelGpuPlacement({
      launchInput,
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
    });

    expect(result).toEqual({
      success: true,
      mode: LlamaCppModelGpuPlacementMode.Explicit,
      input: launchInput,
    });
  });

  test('allows a manual budget when the model estimate fits system-memory budget plus free VRAM', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({ options: { ctxSize: 1024 } }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      memoryPolicy: LlamaCppMemoryPolicy.Manual,
      memoryBudgetPercent: 50,
      systemMemorySnapshot: systemMemorySnapshot({ totalMemoryMiB: 64_000, freeMemoryMiB: 40_000 }),
      nvidiaSnapshot: availableSnapshot(8_000),
      modelSizeBytes: gib(32),
    });

    expect(result).toMatchObject({ success: true, mode: LlamaCppModelGpuPlacementMode.Auto });
  });

  test('blocks a manual budget when the model estimate exceeds system-memory budget plus free VRAM', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({ options: { ctxSize: 1024 } }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      memoryPolicy: LlamaCppMemoryPolicy.Manual,
      memoryBudgetPercent: 50,
      systemMemorySnapshot: systemMemorySnapshot({ totalMemoryMiB: 64_000, freeMemoryMiB: 40_000 }),
      nvidiaSnapshot: availableSnapshot(8_000),
      modelSizeBytes: gib(40),
    });

    expect(result).toMatchObject({
      success: false,
      reason: LlamaCppModelLoadFailureReason.SystemMemoryInsufficient,
    });
    expect(result.success === false && result.requiredMemoryMiB).toBeGreaterThan(
      result.success === false ? result.availableMemoryMiB ?? 0 : 0,
    );
  });

  test('blocks manual loading when a system-memory snapshot is unavailable', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput(),
      memoryPolicy: LlamaCppMemoryPolicy.Manual,
      modelSizeBytes: gib(7),
    });

    expect(result).toMatchObject({
      success: false,
      reason: LlamaCppModelLoadFailureReason.SystemMemoryInsufficient,
    });
  });

  test('estimates model startup memory from model size and context buffer', () => {
    expect(
      estimateRequiredLlamaCppModelVramMiB({ modelSizeBytes: gib(10), ctxSize: 4096 }),
    ).toBe(Math.ceil(10 * 1024 * LlamaCppModelGpuPlacementDefaults.ModelSizeMultiplier) + 4 * 256);
  });
});

function modelLaunchInput(input: Partial<LlamaCppModelLaunchInput> = {}): LlamaCppModelLaunchInput {
  return { model: input.model ?? 'qwen.gguf', modelPath: input.modelPath, options: input.options };
}

function gpuCapabilities() {
  return { success: true, deviceProbeSucceeded: true, gpuDeviceCount: 1, backendKinds: ['cuda'] };
}

function availableSnapshot(memoryFreeMiB: number): NvidiaSmiSnapshot {
  return {
    source: 'nvidia-smi',
    available: true,
    checkedAt: '2026-08-13T00:00:00.000Z',
    gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: memoryFreeMiB, memoryFreeMiB }],
  };
}

function systemMemorySnapshot(input: {
  totalMemoryMiB: number;
  freeMemoryMiB: number;
}): SystemMemorySnapshot {
  return { source: 'system', available: true, checkedAt: '2026-08-13T00:00:00.000Z', ...input };
}

function gib(value: number): number {
  return value * 1024 * 1024 * 1024;
}
