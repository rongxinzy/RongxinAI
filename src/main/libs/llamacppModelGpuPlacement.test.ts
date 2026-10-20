import { describe, expect, test, vi, beforeEach } from 'vitest';

import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../../shared/hardware';
import {
  LlamaCppMemoryPolicy,
  type LlamaCppModelLaunchInput,
  LlamaCppRuntimeBackend,
} from '../../shared/llamacpp';
import { modelLaunchOptionsToPreset } from './llamacppManager/fileUtils';
import {
  estimateRequiredLlamaCppModelVramMiB,
  LlamaCppModelGpuPlacementMode,
  planLlamaCppModelGpuPlacement,
} from './llamacppModelGpuPlacement';
import { LlamaCppModelLoadFailureReason } from './llamacppModelLoadErrors';
import { readGgufBlockCount } from './ggufMetadata';

vi.mock('./ggufMetadata', async importOriginal => {
  const actual = await importOriginal<typeof import('./ggufMetadata')>();
  return { ...actual, readGgufBlockCount: vi.fn(actual.readGgufBlockCount) };
});

beforeEach(() => {
  vi.mocked(readGgufBlockCount).mockReset();
});

describe('llamacppModelGpuPlacement', () => {
  test('writes llama.cpp device IDs for automatically selected GPUs', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({ options: { ctxSize: 8192 } }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities(),
      nvidiaSnapshot: availableSnapshot([
        { index: 0, memoryFreeMiB: 8_000 },
        { index: 1, memoryFreeMiB: 8_000 },
      ]),
      modelSizeBytes: gib(14),
    });

    expect(result).toMatchObject({
      success: true,
      mode: LlamaCppModelGpuPlacementMode.Auto,
    });
    expect(result.success && result.input.options?.gpuLayers).toBe('auto');
    expect(result.success && result.input.options?.device).toBe('CUDA0,CUDA1');
  });

  // Guard for llama-server's --fit (ON by default): fit keeps dense/attention
  // weights on GPU and moves overflow MoE expert tensors to CPU across
  // devices, but ABORTS (common/fit.cpp:352-375) when the caller sets a
  // numeric/all n_gpu_layers (anything other than `auto`), tensor_split,
  // split-mode `row`, or any tensor_buft_override (`--n-cpu-moe`, `--cpu-moe`,
  // `--override-tensor`). The auto path must therefore never emit those keys.
  // The planner has no per-device VRAM margin of its own, so --fit-target is
  // deliberately not passed and fit's default margin applies.
  describe.each([
    ['single GPU', availableSnapshot([{ index: 0, memoryFreeMiB: 24_000 }])],
    [
      'dual GPU',
      availableSnapshot([
        { index: 0, memoryFreeMiB: 12_000 },
        { index: 1, memoryFreeMiB: 12_000 },
      ]),
    ],
  ])('auto placement fit guard (%s)', (_label, nvidiaSnapshot) => {
    test('keeps fit enabled: gpuLayers auto, no tensor overrides', () => {
      const result = planLlamaCppModelGpuPlacement({
        launchInput: modelLaunchInput({ options: { ctxSize: 8192 } }),
        runtimeBackend: LlamaCppRuntimeBackend.Cuda,
        runtimeCapabilities: gpuCapabilities(),
        nvidiaSnapshot,
        modelSizeBytes: gib(14),
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.mode).toBe(LlamaCppModelGpuPlacementMode.Auto);
      expect(result.input.options?.gpuLayers).toBe('auto');
      expect(result.input.options?.tensorSplit).toBeUndefined();
      expect(result.input.options?.splitMode).not.toBe('row');

      const preset = modelLaunchOptionsToPreset(result.input.options ?? {});
      if (preset['n-gpu-layers'] !== undefined) {
        expect(preset['n-gpu-layers']).toBe('auto');
      }
      expect(preset['tensor-split']).toBeUndefined();
      expect(preset['n-cpu-moe']).toBeUndefined();
      expect(preset['override-tensor']).toBeUndefined();
      expect(preset['cpu-moe']).toBeUndefined();
    });
  });

  test('does not treat nCpuMoe as explicit GPU placement and keeps gpuLayers auto', () => {
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({
        modelPath: '/models/qwen3-30b.gguf',
        options: { nCpuMoe: 12 },
      }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities(),
      nvidiaSnapshot: availableSnapshot([{ index: 0, memoryFreeMiB: 24_000 }]),
      modelSizeBytes: gib(18),
    });

    expect(result).toMatchObject({
      success: true,
      mode: LlamaCppModelGpuPlacementMode.Auto,
    });
    expect(result.success && result.input.options?.gpuLayers).toBe('auto');
    expect(result.success && result.input.options?.nCpuMoe).toBe(12);
    expect(
      result.success && modelLaunchOptionsToPreset(result.input.options ?? {})['n-cpu-moe'],
    ).toBe(12);
  });

  test('rejects nCpuMoe exceeding the model block count', () => {
    vi.mocked(readGgufBlockCount).mockReturnValue(48);
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({
        modelPath: '/models/qwen3-30b-a3b.gguf',
        options: { nCpuMoe: 49 },
      }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities(),
      nvidiaSnapshot: availableSnapshot([{ index: 0, memoryFreeMiB: 24_000 }]),
      modelSizeBytes: gib(18),
    });

    expect(result).toMatchObject({
      success: false,
      reason: LlamaCppModelLoadFailureReason.ModelFileInvalid,
    });
    expect(result.success === false && result.detail).toContain('49');
  });

  test('allows nCpuMoe within the model block count (Qwen3-30B-A3B: 48)', () => {
    vi.mocked(readGgufBlockCount).mockReturnValue(48);
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({
        modelPath: '/models/qwen3-30b-a3b.gguf',
        options: { nCpuMoe: 48 },
      }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities(),
      nvidiaSnapshot: availableSnapshot([{ index: 0, memoryFreeMiB: 24_000 }]),
      modelSizeBytes: gib(18),
    });

    expect(result).toMatchObject({
      success: true,
      mode: LlamaCppModelGpuPlacementMode.Auto,
    });
  });

  test('passes nCpuMoe through when the block count is unreadable', () => {
    vi.mocked(readGgufBlockCount).mockReturnValue(undefined);
    const result = planLlamaCppModelGpuPlacement({
      launchInput: modelLaunchInput({
        modelPath: '/models/unknown.gguf',
        options: { nCpuMoe: 999 },
      }),
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities(),
      nvidiaSnapshot: availableSnapshot([{ index: 0, memoryFreeMiB: 24_000 }]),
      modelSizeBytes: gib(18),
    });

    expect(result).toMatchObject({ success: true });
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
      nvidiaSnapshot: availableSnapshot([{ index: 0, memoryFreeMiB: 8_000 }]),
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
      nvidiaSnapshot: availableSnapshot([{ index: 0, memoryFreeMiB: 8_000 }]),
      modelSizeBytes: gib(52),
    });

    expect(result).toMatchObject({
      success: false,
      reason: LlamaCppModelLoadFailureReason.SystemMemoryInsufficient,
    });
    expect(result.success === false && result.requiredMemoryMiB).toBeGreaterThan(
      result.success === false ? (result.availableMemoryMiB ?? 0) : 0,
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

  test('estimates model startup memory from model size and KV cache context', () => {
    const small = estimateRequiredLlamaCppModelVramMiB({
      modelSizeBytes: gib(10),
      contextSize: 4096,
    });
    const large = estimateRequiredLlamaCppModelVramMiB({
      modelSizeBytes: gib(10),
      contextSize: 32_768,
    });
    expect(small).toBeGreaterThan(8 * 1024);
    expect(large).toBeGreaterThan(small);
  });
});

function modelLaunchInput(input: Partial<LlamaCppModelLaunchInput> = {}): LlamaCppModelLaunchInput {
  return { model: input.model ?? 'qwen.gguf', modelPath: input.modelPath, options: input.options };
}

function gpuCapabilities() {
  return {
    success: true,
    deviceProbeSucceeded: true,
    devices: [
      { id: 'CUDA0', name: 'GPU 0', backend: 'cuda' },
      { id: 'CUDA1', name: 'GPU 1', backend: 'cuda' },
    ],
    gpuDeviceCount: 2,
    backendKinds: ['cuda'],
  };
}

function availableSnapshot(
  gpus: Array<{ index: number; memoryFreeMiB: number }>,
): NvidiaSmiSnapshot {
  return {
    source: 'nvidia-smi',
    available: true,
    checkedAt: '2026-08-13T00:00:00.000Z',
    gpus: gpus.map(gpu => ({
      index: gpu.index,
      name: `GPU ${gpu.index}`,
      memoryTotalMiB: gpu.memoryFreeMiB,
      memoryFreeMiB: gpu.memoryFreeMiB,
    })),
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
