import { describe, expect, test, vi } from 'vitest';

import type { NvidiaSmiSnapshot } from '../../shared/hardware';
import type {
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel,
  LlamaCppRuntimeCapabilities,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { LlamaCppRuntimeBackend } from '../../shared/llamacpp';
import {
  LlamaCppModelLoadError,
  LlamaCppModelLoadFailureReason,
} from './llamacppModelLoadErrors';
import { loadLlamaCppModelThroughPipeline } from './llamacppModelLoadPipeline';

describe('llamacppModelLoadPipeline', () => {
  test('applies gpu placement before loading and returns the final launch input', async () => {
    const loadModel = vi.fn(async (input: LlamaCppModelLaunchInput) => ({
      success: true as const,
      runningModels: [runningModel(input.model)],
    }));

    const result = await loadLlamaCppModelThroughPipeline({
      launchInput: { model: 'qwen.gguf', options: { ctxSize: 4096 } },
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities(1),
      nvidiaSnapshot: availableSnapshot([{ index: 0, memoryFreeMiB: 24_000 }]),
      modelSizeBytes: gib(7),
      loadModel,
      listModels: async () => [loadedModel('qwen.gguf')],
      listRunningModels: async () => [runningModel('qwen.gguf')],
      detectService: async () => runningService(),
    });

    expect(loadModel).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        device: '0',
        gpuLayers: 'auto',
      }),
    }));
    expect(result.finalInput.options?.device).toBe('0');
    expect(result.runningModels).toHaveLength(1);
  });

  test('keeps cpu launch input unchanged for cpu runtime', async () => {
    const launchInput: LlamaCppModelLaunchInput = { model: 'qwen.gguf', options: { ctxSize: 2048 } };
    const loadModel = vi.fn(async () => ({
      success: true as const,
      runningModels: [runningModel('qwen.gguf')],
    }));

    const result = await loadLlamaCppModelThroughPipeline({
      launchInput,
      runtimeBackend: LlamaCppRuntimeBackend.Cpu,
      runtimeCapabilities: gpuCapabilities(0, ['cpu']),
      nvidiaSnapshot: null,
      loadModel,
      listModels: async () => [loadedModel('qwen.gguf')],
      listRunningModels: async () => [runningModel('qwen.gguf')],
      detectService: async () => runningService(),
    });

    expect(loadModel).toHaveBeenCalledWith(launchInput);
    expect(result.finalInput).toEqual(launchInput);
  });

  test('retries once with a reduced context size after a retryable load failure', async () => {
    const loadModel = vi
      .fn()
      .mockRejectedValueOnce(new Error('CUDA error: out of memory'))
      .mockResolvedValueOnce({
        success: true,
        runningModels: [runningModel('qwen.gguf')],
      });
    const unloadModel = vi.fn(async () => undefined);

    const result = await loadLlamaCppModelThroughPipeline({
      launchInput: { model: 'qwen.gguf', options: { ctxSize: 8192 } },
      runtimeBackend: LlamaCppRuntimeBackend.Cpu,
      loadModel,
      listModels: async () => [loadedModel('qwen.gguf')],
      listRunningModels: async () => [runningModel('qwen.gguf', 'loading')],
      detectService: async () => runningService(),
      unloadModel,
    });

    expect(loadModel).toHaveBeenCalledTimes(2);
    expect(loadModel.mock.calls[0][0].options?.ctxSize).toBe(8192);
    expect(loadModel.mock.calls[1][0].options?.ctxSize).toBe(4096);
    expect(unloadModel).toHaveBeenCalledWith('qwen.gguf');
    expect(result.finalInput.options?.ctxSize).toBe(4096);
  });

  test('fails before load when gpu runtime has no detected gpu', async () => {
    const loadModel = vi.fn(async () => ({
      success: true as const,
      runningModels: [runningModel('qwen.gguf')],
    }));

    await expect(loadLlamaCppModelThroughPipeline({
      launchInput: { model: 'qwen.gguf', options: { ctxSize: 4096 } },
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCapabilities: gpuCapabilities(0),
      nvidiaSnapshot: availableSnapshot([]),
      modelSizeBytes: gib(7),
      loadModel,
      listModels: async () => [],
      listRunningModels: async () => [],
      detectService: async () => runningService(),
    })).rejects.toMatchObject({
      reason: LlamaCppModelLoadFailureReason.GpuNotFound,
    } satisfies Partial<LlamaCppModelLoadError>);

    expect(loadModel).not.toHaveBeenCalled();
  });

  test('maps a non-loaded settle result to a startup timeout failure', async () => {
    await expect(loadLlamaCppModelThroughPipeline({
      launchInput: { model: 'qwen.gguf', options: { ctxSize: 4096 } },
      runtimeBackend: LlamaCppRuntimeBackend.Cpu,
      loadModel: async () => ({ success: true, runningModels: [] }),
      listModels: async () => [loadedModel('qwen.gguf', 'loading')],
      listRunningModels: async () => [],
      detectService: async () => runningService(),
      startupBudgetMs: 0,
    })).rejects.toMatchObject({
      reason: LlamaCppModelLoadFailureReason.StartupTimeout,
    } satisfies Partial<LlamaCppModelLoadError>);
  });
});

function gpuCapabilities(
  gpuDeviceCount: number,
  backendKinds: string[] = ['cuda'],
): LlamaCppRuntimeCapabilities {
  return {
    success: true,
    flags: [],
    deviceProbeSucceeded: true,
    devices: [],
    backendKinds,
    gpuDeviceCount,
    supports: {},
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

function runningService(): LlamaCppStatusSnapshot {
  return {
    status: 'running',
    checkedAt: '2026-07-13T00:00:00.000Z',
  };
}

function loadedModel(
  name: string,
  status: NonNullable<LlamaCppModel['status']> = 'loaded',
): LlamaCppModel {
  return {
    name,
    status,
  };
}

function runningModel(
  name: string,
  status: NonNullable<LlamaCppRunningModel['status']> = 'loaded',
): LlamaCppRunningModel {
  return {
    name,
    status,
  };
}

function gib(value: number): number {
  return value * 1024 * 1024 * 1024;
}
