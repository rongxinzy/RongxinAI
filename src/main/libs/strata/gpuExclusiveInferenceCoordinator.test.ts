import { describe, expect, test, vi } from 'vitest';
import { StrataServiceStatus } from '../../../shared/strata/types';

import { releaseGpuForLlamaCpp, releaseGpuForStrata } from './gpuExclusiveInferenceCoordinator';

describe('gpuExclusiveInferenceCoordinator', () => {
  test('releaseGpuForStrata unloads all llama.cpp router models', async () => {
    const stopAll = vi.fn(async () => ({ runningModels: [], modelProcesses: [] }));
    await releaseGpuForStrata({ stopAll } as never);
    expect(stopAll).toHaveBeenCalledOnce();
  });

  test('releaseGpuForLlamaCpp stops managed Strata', async () => {
    const stop = vi.fn(async () => ({ status: StrataServiceStatus.Stopped }));
    await releaseGpuForLlamaCpp({ stop } as never);
    expect(stop).toHaveBeenCalledOnce();
  });

  test('refuses handoff while either engine reports unresolved model ownership', async () => {
    const stopAll = vi.fn(async () => ({ runningModels: [{}], modelProcesses: [] }));
    const stop = vi.fn(async () => ({ status: StrataServiceStatus.Error, managedByApp: true }));
    await expect(releaseGpuForStrata({ stopAll } as never)).rejects.toThrow('until');
    await expect(releaseGpuForLlamaCpp({ stop } as never)).rejects.toThrow('until');
  });
});
