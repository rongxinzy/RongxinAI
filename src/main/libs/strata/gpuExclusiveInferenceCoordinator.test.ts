import { describe, expect, test, vi } from 'vitest';

import { releaseGpuForLlamaCpp, releaseGpuForStrata } from './gpuExclusiveInferenceCoordinator';

describe('gpuExclusiveInferenceCoordinator', () => {
  test('releaseGpuForStrata unloads all llama.cpp router models', async () => {
    const stopAll = vi.fn(async () => ({}));
    await releaseGpuForStrata({ stopAll } as never);
    expect(stopAll).toHaveBeenCalledOnce();
  });

  test('releaseGpuForLlamaCpp stops managed Strata', async () => {
    const stop = vi.fn(async () => ({}));
    await releaseGpuForLlamaCpp({ stop } as never);
    expect(stop).toHaveBeenCalledOnce();
  });
});
