import { expect, test } from 'vitest';

import { LlamaCppRuntimeBackend, LlamaCppRuntimeCudaMajor } from '../../shared/llamacpp';
import {
  getLlamaCppLoadedModelLimitViolation,
  getRequiredVramRecoveryMiB,
  getTotalFreeVramMiB,
  hasRecoveredVram,
  sanitizeLlamaCppServiceConfig,
  shouldSyncOpenClawAfterRunningModelRefresh,
  waitForLlamaCppModelUnloadConfirmation,
} from './llamacpp';

test('sanitizeLlamaCppServiceConfig keeps valid fields and falls back for malformed structured numbers', () => {
  expect(sanitizeLlamaCppServiceConfig({
    host: ' 0.0.0.0 ',
    port: 'not-a-port',
    modelsDir: ' /tmp/models ',
    modelsMax: '2',
    modelsAutoload: 'true' as unknown as boolean,
    ctxSize: '8192',
    parallel: '2x',
    gpuLayers: 'all',
    threads: '8',
    batchSize: '256',
    ubatchSize: '64',
    runtimeBackend: LlamaCppRuntimeBackend.Cuda,
    runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
    device: ' 0,1 ',
    mainGpu: '-1',
    splitMode: 'layer',
    tensorSplit: ' 3,2 ',
    flashAttn: 'maybe' as 'auto',
    reasoning: 'on',
    chatTemplate: 'chatml',
    reasoningFormat: 'invalid' as 'auto',
  })).toEqual({
    host: '0.0.0.0',
    modelsDir: '/tmp/models',
    modelsMax: '2',
    modelsAutoload: true,
    ctxSize: '8192',
    parallel: '1',
    gpuLayers: 'all',
    threads: '8',
    batchSize: '256',
    ubatchSize: '64',
    runtimeBackend: LlamaCppRuntimeBackend.Cuda,
    runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
    device: '0,1',
    mainGpu: '0',
    splitMode: 'layer',
    reasoning: 'on',
    chatTemplate: 'chatml',
  });
});

test('sanitizeLlamaCppServiceConfig maps malformed structured numeric strings to explicit defaults', () => {
  expect(sanitizeLlamaCppServiceConfig({
    modelsMax: 'abc',
    timeout: '1.5',
    threadsHttp: 'auto',
    cacheReuse: 'one',
    cacheRam: '8g',
    ctxSize: '4k',
    parallel: 'two',
    batchSize: 'NaN',
    ubatchSize: '--',
    gpuLayers: 'gpu',
    threads: 'fast',
    threadsBatch: 'many',
    mainGpu: 'main',
  })).toEqual({
    modelsMax: '0',
    timeout: '600',
    threadsHttp: '4',
    cacheReuse: '256',
    cacheRam: '8192',
    ctxSize: '4096',
    parallel: '1',
    batchSize: '2048',
    ubatchSize: '512',
    gpuLayers: 'auto',
    threads: '-1',
    threadsBatch: '-1',
    mainGpu: '0',
  });
});

test('sanitizeLlamaCppServiceConfig maps out-of-range numeric values to explicit defaults', () => {
  expect(sanitizeLlamaCppServiceConfig({
    modelsMax: '9999999',
    timeout: '9999999',
    threadsHttp: '9999999',
    ctxSize: '9999999',
    parallel: '9999999',
    batchSize: '9999999',
    ubatchSize: '9999999',
    gpuLayers: '9999999',
    threads: '9999999',
    threadsBatch: '9999999',
    mainGpu: '9999999',
    cacheReuse: '9999999',
    cacheRam: '9999999',
  })).toEqual({
    modelsMax: '0',
    timeout: '600',
    threadsHttp: '4',
    cacheReuse: '256',
    cacheRam: '8192',
    ctxSize: '4096',
    parallel: '1',
    batchSize: '2048',
    ubatchSize: '512',
    gpuLayers: 'auto',
    threads: '-1',
    threadsBatch: '-1',
    mainGpu: '0',
  });
});

test('sanitizeLlamaCppServiceConfig drops invalid tensor split values', () => {
  expect(sanitizeLlamaCppServiceConfig({
    tensorSplit: '9999',
  })).toEqual({});

  expect(sanitizeLlamaCppServiceConfig({
    splitMode: 'tensor',
    tensorSplit: '按张量拆分',
  })).toEqual({
    splitMode: 'tensor',
  });

  expect(sanitizeLlamaCppServiceConfig({
    splitMode: 'tensor',
    tensorSplit: '3,2',
  })).toEqual({
    splitMode: 'tensor',
    tensorSplit: '3,2',
  });
});

test('sanitizeLlamaCppServiceConfig drops invalid structured device values', () => {
  expect(sanitizeLlamaCppServiceConfig({
    device: '显卡0',
  })).toEqual({});
});

test('sanitizeLlamaCppServiceConfig drops tensor split when split mode is not tensor', () => {
  expect(sanitizeLlamaCppServiceConfig({
    splitMode: 'layer',
    tensorSplit: '3,2',
  })).toEqual({
    splitMode: 'layer',
  });
});

test('sanitizeLlamaCppServiceConfig drops tensor split when it exceeds available device count', () => {
  expect(sanitizeLlamaCppServiceConfig({
    splitMode: 'tensor',
    tensorSplit: '3,2,1',
  })).toEqual({
    splitMode: 'tensor',
    tensorSplit: '3,2,1',
  });
});
test('sanitizeLlamaCppServiceConfig drops invalid runtime backend fields', () => {
  expect(sanitizeLlamaCppServiceConfig({
    runtimeBackend: 'metal' as unknown as LlamaCppRuntimeBackend,
    runtimeCudaMajor: '11' as unknown as LlamaCppRuntimeCudaMajor,
  })).toEqual({});
});

test('sanitizeLlamaCppServiceConfig treats an empty modelsMax as zero for unlimited router slots', () => {
  expect(sanitizeLlamaCppServiceConfig({
    modelsMax: '',
  })).toEqual({
    modelsMax: '0',
  });
});

test('sanitizeLlamaCppServiceConfig normalizes numeric device indexes to CUDA device ids', () => {
  expect(sanitizeLlamaCppServiceConfig(
    {
      device: '0,1',
    },
    {
      success: true,
      devices: [
        { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090' },
        { id: 'CUDA1', name: 'NVIDIA GeForce RTX 4080' },
      ],
    },
  )).toEqual({
    device: 'CUDA0,CUDA1',
  });
});

test('sanitizeLlamaCppServiceConfig maps numeric device indexes to runtime devices on non-CUDA backends', () => {
  expect(sanitizeLlamaCppServiceConfig(
    {
      device: '0',
    },
    {
      success: true,
      devices: [
        { id: 'METAL0', name: 'Apple GPU', backend: 'metal' },
        { id: 'CPU', name: 'CPU', backend: 'cpu' },
      ],
    },
  )).toEqual({
    device: 'METAL0',
  });
});

test('sanitizeLlamaCppServiceConfig preserves explicit runtime device ids on non-CUDA backends', () => {
  expect(sanitizeLlamaCppServiceConfig(
    {
      device: 'METAL0',
    },
    {
      success: true,
      devices: [
        { id: 'METAL0', name: 'Apple GPU', backend: 'metal' },
        { id: 'CPU', name: 'CPU', backend: 'cpu' },
      ],
    },
  )).toEqual({
    device: 'METAL0',
  });
});

test('sanitizeLlamaCppServiceConfig clears invalid visible devices back to default visibility', () => {
  expect(sanitizeLlamaCppServiceConfig(
    {
      device: '0,3',
    },
    {
      success: true,
      devices: [
        { id: 'CUDA0', name: 'NVIDIA GeForce RTX 4090' },
        { id: 'CUDA1', name: 'NVIDIA GeForce RTX 4080' },
      ],
    },
  )).toEqual({});
});

test('getLlamaCppLoadedModelLimitViolation blocks loading a third model when modelsMax is two', () => {
  expect(getLlamaCppLoadedModelLimitViolation({
    modelsMax: '2',
    runningModels: [
      { name: 'Qwen3-0.6B-GGUF' },
      { name: 'Qwen3-1.7B-GGUF' },
    ],
    targetModelName: 'Qwen3-4B-GGUF',
  })).toEqual({
    limit: 2,
    next: 3,
  });
});

test('getLlamaCppLoadedModelLimitViolation allows reloading an already running model', () => {
  expect(getLlamaCppLoadedModelLimitViolation({
    modelsMax: '2',
    runningModels: [
      { name: 'Qwen3-0.6B-GGUF' },
      { name: 'Qwen3-1.7B-GGUF' },
    ],
    targetModelName: 'Qwen3-1.7B-GGUF',
  })).toBeNull();
});

test('shouldSyncOpenClawAfterRunningModelRefresh only syncs on model stop', () => {
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-model-loaded')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-model-unloaded')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-status-running')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-status-not-running')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-model-deleted')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-model-visibility-refresh')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-model-launched')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-set-openclaw-model')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-model-stopped')).toBe(true);
});

test('computes total free VRAM from nvidia-smi snapshots', () => {
  expect(getTotalFreeVramMiB({
    source: 'nvidia-smi',
    available: true,
    checkedAt: '2026-05-20T00:00:00.000Z',
    gpus: [
      { index: 0, name: 'GPU 0', memoryTotalMiB: 8192, memoryFreeMiB: 1024 },
      { index: 1, name: 'GPU 1', memoryTotalMiB: 8192, memoryFreeMiB: 2048 },
    ],
  })).toBe(3072);
});

test('uses a bounded VRAM recovery threshold for unload confirmation', () => {
  expect(getRequiredVramRecoveryMiB(256 * 1024 * 1024)).toBe(64);
  expect(getRequiredVramRecoveryMiB(4 * 1024 * 1024 * 1024)).toBe(512);
});

test('detects when VRAM has recovered enough after unload', () => {
  const beforeSnapshot = {
    source: 'nvidia-smi' as const,
    available: true,
    checkedAt: '2026-05-20T00:00:00.000Z',
    gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: 8192, memoryFreeMiB: 1024 }],
  };

  expect(hasRecoveredVram({
    beforeSnapshot,
    currentSnapshot: {
      ...beforeSnapshot,
      checkedAt: '2026-05-20T00:00:01.000Z',
      gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: 8192, memoryFreeMiB: 1180 }],
    },
    sizeVramBytes: 512 * 1024 * 1024,
  })).toBe(true);

  expect(hasRecoveredVram({
    beforeSnapshot,
    currentSnapshot: {
      ...beforeSnapshot,
      checkedAt: '2026-05-20T00:00:01.000Z',
      gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: 8192, memoryFreeMiB: 1050 }],
    },
    sizeVramBytes: 512 * 1024 * 1024,
  })).toBe(false);
});

test('confirms model unload after consecutive missing polls', async () => {
  const polls = [
    [{ name: 'model-a' }],
    [],
    [],
  ];
  let index = 0;

  await expect(waitForLlamaCppModelUnloadConfirmation({
    modelName: 'model-a',
    listRunningModels: async () => polls[Math.min(index++, polls.length - 1)],
    timeoutMs: 50,
    intervalMs: 0,
    stableMissingPolls: 2,
  })).resolves.toEqual({
    confirmed: true,
    runningModels: [],
  });
});

test('returns the last running-model snapshot when unload confirmation times out', async () => {
  const runningModels = [{ name: 'model-a' }];

  await expect(waitForLlamaCppModelUnloadConfirmation({
    modelName: 'model-a',
    listRunningModels: async () => runningModels,
    timeoutMs: 0,
    intervalMs: 0,
    stableMissingPolls: 2,
  })).resolves.toEqual({
    confirmed: false,
    runningModels,
  });
});
