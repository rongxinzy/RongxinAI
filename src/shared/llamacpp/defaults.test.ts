import { expect, test } from 'vitest';

import {
  applyAutomaticLlamaCppServiceDefaults,
  DEFAULT_LLAMACPP_SERVICE_CONFIG,
  resolveAutomaticLlamaCppContextSize,
} from './defaults';

test('llama.cpp service defaults are explicit and stable', () => {
  expect(DEFAULT_LLAMACPP_SERVICE_CONFIG).toEqual({
    host: '127.0.0.1',
    port: '8080',
    modelsMax: '0',
    timeout: '120',
    threadsHttp: '4',
    cacheReuse: '256',
    cacheRam: '8192',
    parallel: '1',
    batchSize: '512',
    ubatchSize: '512',
    gpuLayers: 'auto',
  });
});

test('resolveAutomaticLlamaCppContextSize uses the local two-tier VRAM defaults', () => {
  expect(resolveAutomaticLlamaCppContextSize(null)).toBe('8192');
  expect(resolveAutomaticLlamaCppContextSize({
    source: 'nvidia-smi',
    available: true,
    checkedAt: '2026-07-03T00:00:00.000Z',
    gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: 4096 }],
  })).toBe('8192');
  expect(resolveAutomaticLlamaCppContextSize({
    source: 'nvidia-smi',
    available: true,
    checkedAt: '2026-07-03T00:00:00.000Z',
    gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: 19 * 1024 }],
  })).toBe('8192');
  expect(resolveAutomaticLlamaCppContextSize({
    source: 'nvidia-smi',
    available: true,
    checkedAt: '2026-07-03T00:00:00.000Z',
    gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: 20 * 1024 }],
  })).toBe('32768');
});

test('applyAutomaticLlamaCppServiceDefaults fills ctxSize only when unset', () => {
  expect(applyAutomaticLlamaCppServiceDefaults({
    host: '127.0.0.1',
  }, {
    nvidiaSnapshot: {
      source: 'nvidia-smi',
      available: true,
      checkedAt: '2026-07-03T00:00:00.000Z',
      gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: 19 * 1024 }],
    },
  })).toEqual({
    host: '127.0.0.1',
    ctxSize: '8192',
  });

  expect(applyAutomaticLlamaCppServiceDefaults({
    host: '127.0.0.1',
    ctxSize: '8192',
  }, {
    nvidiaSnapshot: {
      source: 'nvidia-smi',
      available: true,
      checkedAt: '2026-07-03T00:00:00.000Z',
      gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: 48 * 1024 }],
    },
  })).toEqual({
    host: '127.0.0.1',
    ctxSize: '8192',
  });
});
