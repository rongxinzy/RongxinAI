import { expect, test } from 'vitest';

import { LlamaCppRuntimeBackend, LlamaCppRuntimeCudaMajor } from '../../shared/llamacpp';
import {
  getRequiredVramRecoveryMiB,
  getTotalFreeVramMiB,
  hasRecoveredVram,
  sanitizeLlamaCppServiceConfig,
  shouldSyncOpenClawAfterRunningModelRefresh,
  waitForLlamaCppModelUnloadConfirmation,
} from './llamacpp';

test('sanitizeLlamaCppServiceConfig keeps valid fields and drops invalid numeric and enum values', () => {
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
    gpuLayers: 'all',
    threads: '8',
    batchSize: '256',
    ubatchSize: '64',
    runtimeBackend: LlamaCppRuntimeBackend.Cuda,
    runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
    device: '0,1',
    splitMode: 'layer',
    tensorSplit: '3,2',
    reasoning: 'on',
    chatTemplate: 'chatml',
  });
});

test('sanitizeLlamaCppServiceConfig drops invalid runtime backend fields', () => {
  expect(sanitizeLlamaCppServiceConfig({
    runtimeBackend: 'metal' as unknown as LlamaCppRuntimeBackend,
    runtimeCudaMajor: '11' as unknown as LlamaCppRuntimeCudaMajor,
  })).toEqual({
    modelsMax: '0',
  });
});

test('sanitizeLlamaCppServiceConfig treats an empty modelsMax as zero for unlimited router slots', () => {
  expect(sanitizeLlamaCppServiceConfig({
    modelsMax: '',
  })).toEqual({
    modelsMax: '0',
  });
});

test('shouldSyncOpenClawAfterRunningModelRefresh only allows explicit OpenClaw model selection', () => {
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-model-loaded')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-model-unloaded')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-status-running')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-status-not-running')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-model-deleted')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-model-visibility-refresh')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-model-launched')).toBe(false);
  expect(shouldSyncOpenClawAfterRunningModelRefresh('llamacpp-set-openclaw-model')).toBe(true);
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
