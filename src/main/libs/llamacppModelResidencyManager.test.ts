import { afterEach, expect, test, vi } from 'vitest';

import { LlamaCppModelResidencyMode } from '../../shared/llamacpp';
import {
  LlamaCppModelResidencyManager,
  LlamaCppModelResidencyState,
} from './llamacppModelResidencyManager';

afterEach(() => {
  vi.useRealTimers();
});

test('unloads a ready model after its configured idle duration', async () => {
  vi.useFakeTimers();
  const unload = vi.fn(async () => undefined);
  const manager = new LlamaCppModelResidencyManager({
    unload,
    getPolicy: () => ({ mode: LlamaCppModelResidencyMode.Timed, idleMinutes: 5 }),
  });

  manager.markReady('qwen-local');
  await vi.advanceTimersByTimeAsync(5 * 60_000);

  expect(unload).toHaveBeenCalledWith('qwen-local');
  expect(manager.getSnapshot('qwen-local')?.state).toBe(LlamaCppModelResidencyState.Unloaded);
  manager.dispose();
});

test('does not unload while a model request lease is active', async () => {
  vi.useFakeTimers();
  const unload = vi.fn(async () => undefined);
  const manager = new LlamaCppModelResidencyManager({
    unload,
    getPolicy: () => ({ mode: LlamaCppModelResidencyMode.Timed, idleMinutes: 5 }),
  });

  const release = await manager.acquire('qwen-local', async () => undefined);
  await vi.advanceTimersByTimeAsync(10 * 60_000);

  expect(unload).not.toHaveBeenCalled();
  release();
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(unload).toHaveBeenCalledWith('qwen-local');
  manager.dispose();
});

test('shares one loading operation between concurrent requests', async () => {
  let resolveLoad: (() => void) | undefined;
  const loading = new Promise<void>(resolve => {
    resolveLoad = resolve;
  });
  const load = vi.fn(async () => await loading);
  const manager = new LlamaCppModelResidencyManager({
    unload: async () => undefined,
    getPolicy: () => ({ mode: LlamaCppModelResidencyMode.Forever }),
  });

  const first = manager.acquire('qwen-local', load);
  const second = manager.acquire('qwen-local', load);
  resolveLoad?.();
  const [releaseFirst, releaseSecond] = await Promise.all([first, second]);

  expect(load).toHaveBeenCalledTimes(1);
  expect(manager.getSnapshot('qwen-local')?.activeRequests).toBe(2);
  releaseFirst();
  releaseSecond();
  manager.dispose();
});
