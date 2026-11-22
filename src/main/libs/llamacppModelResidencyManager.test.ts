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

test('blocks new requests for a model while its file is being deleted', async () => {
  const deleting = Promise.withResolvers<void>();
  const load = vi.fn(async () => undefined);
  const manager = new LlamaCppModelResidencyManager({
    unload: async () => undefined,
    getPolicy: () => undefined,
  });

  const deletion = manager.withModelUnavailable('target', () => deleting.promise);
  try {
    await expect(manager.acquire('target', load)).rejects.toThrow('being deleted');
    expect(load).not.toHaveBeenCalled();
    const release = await manager.acquire('other', load);
    release();
  } finally {
    deleting.resolve();
    await deletion;
    manager.dispose();
  }
});

test('reset broadcasts unloaded and fences pending work from the previous service', async () => {
  vi.useFakeTimers();
  const oldLoad = Promise.withResolvers<void>();
  const oldUnload = Promise.withResolvers<void>();
  const unload = vi.fn(() => oldUnload.promise);
  const onStateChanged = vi.fn();
  const manager = new LlamaCppModelResidencyManager({
    unload,
    onStateChanged,
    getPolicy: () => ({ mode: LlamaCppModelResidencyMode.Timed, idleMinutes: 1 }),
  });

  const oldRelease = await manager.acquire('leased', async () => undefined);
  const loading = manager.ensureReady('loading', () => oldLoad.promise);
  const waitingForLease = manager.acquire('loading', async () => undefined);
  manager.markReady('expiring');
  manager.markReady('also-expiring');
  manager.markUnloaded('already-unloaded');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(unload).toHaveBeenCalledExactlyOnceWith('expiring');

  onStateChanged.mockClear();
  manager.reset();

  expect(onStateChanged.mock.calls.map(([snapshot]) => snapshot.modelName)).toEqual([
    'leased',
    'loading',
    'expiring',
    'also-expiring',
  ]);
  for (const [snapshot] of onStateChanged.mock.calls) {
    expect(snapshot).toMatchObject({
      state: LlamaCppModelResidencyState.Unloaded,
      activeRequests: 0,
    });
    expect(snapshot.expiresAt).toBeUndefined();
    expect(manager.getSnapshot(snapshot.modelName)).toBeUndefined();
  }
  expect(vi.getTimerCount()).toBe(0);

  const release = await manager.acquire('leased', async () => undefined);
  manager.markReady('expiring');
  onStateChanged.mockClear();
  oldRelease();
  const staleLoad = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
  const staleAcquire = expect(waitingForLease).rejects.toMatchObject({ name: 'AbortError' });
  oldLoad.resolve();
  oldUnload.resolve();
  await Promise.all([staleLoad, staleAcquire]);

  expect(manager.getSnapshot('loading')).toBeUndefined();
  expect(manager.getSnapshot('leased')?.activeRequests).toBe(1);
  expect(manager.getSnapshot('expiring')?.state).toBe(LlamaCppModelResidencyState.Ready);
  expect(onStateChanged).not.toHaveBeenCalled();
  expect(unload).toHaveBeenCalledExactlyOnceWith('expiring');
  release();
  manager.dispose();
});
