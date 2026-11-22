import { app, powerSaveBlocker } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SqliteStore } from '../sqliteStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_UPDATE_POLL_INTERVAL_MS } from '../../shared/appUpdate/constants';

const sleepState = vi.hoisted(() => ({ started: false }));

vi.mock('electron-updater', () => ({
  autoUpdater: { on: vi.fn(), removeListener: vi.fn() },
}));

vi.mock('electron', async () => {
  const actual = await vi.importActual<typeof import('electron')>('electron');
  return {
    ...actual,
    app: { ...actual.app, isReady: () => true, getPath: () => '/storage-fixture' },
    powerSaveBlocker: {
      start: vi.fn(() => {
        sleepState.started = true;
        return 42;
      }),
      isStarted: vi.fn(() => sleepState.started),
      stop: vi.fn(() => {
        sleepState.started = false;
      }),
    },
  };
});

import {
  clearActiveRunSleepBlockers,
  setActiveRunSleepBlocker,
  setPreventSleepBlockerEnabled,
} from './runtimeServices';

describe('runtimeServices sleep blocker', () => {
  beforeEach(() => {
    clearActiveRunSleepBlockers();
    vi.clearAllMocks();
  });

  it('keeps prevent-app-suspension active while any cowork run is running even if manual setting is off', () => {
    setActiveRunSleepBlocker('session-1', true);
    expect(sleepState.started).toBe(true);
    expect(powerSaveBlocker.start).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension');

    setActiveRunSleepBlocker('session-2', true);
    setActiveRunSleepBlocker('session-1', false);
    expect(sleepState.started).toBe(true);

    setActiveRunSleepBlocker('session-2', false);
    expect(sleepState.started).toBe(false);
    expect(powerSaveBlocker.stop).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('preserves manual prevent-sleep preference across active run completion', () => {
    setPreventSleepBlockerEnabled(true);
    setActiveRunSleepBlocker('session-1', true);
    setActiveRunSleepBlocker('session-1', false);
    expect(sleepState.started).toBe(true);

    setPreventSleepBlockerEnabled(false);
    expect(sleepState.started).toBe(false);
  });
});

const loadRuntimeServices = () => import('./runtimeServices');
const loadStore = () => import('../sqliteStore');
const loadLifecycleState = () => import('./lifecycleRuntimeState');

async function withStoreFixture(
  run: (fixture: {
    store: SqliteStore;
    close: ReturnType<typeof vi.spyOn>;
    open: ReturnType<typeof vi.spyOn>;
    opening: PromiseWithResolvers<SqliteStore>;
    runtime: Awaited<ReturnType<typeof loadRuntimeServices>>;
    lifecycle: Awaited<ReturnType<typeof loadLifecycleState>>['lifecycleRuntime'];
  }) => Promise<void>,
): Promise<void> {
  vi.resetModules();
  const { SqliteStore } = await loadStore();
  const runtime = await loadRuntimeServices();
  const { lifecycleRuntime: lifecycle } = await loadLifecycleState();
  const dir = await mkdtemp(join(tmpdir(), 'zhiyuan-storage-owner-'));
  const store = await SqliteStore.create(dir);
  const close = vi.spyOn(store, 'close');
  const opening = Promise.withResolvers<typeof store>();
  const open = vi.spyOn(SqliteStore, 'create').mockReturnValue(opening.promise);
  const ready = vi.spyOn(app, 'isReady').mockReturnValue(true);
  const getPath = vi.spyOn(app, 'getPath').mockReturnValue(dir);
  vi.useFakeTimers();
  try {
    await run({ store, close, open, opening, runtime, lifecycle });
  } finally {
    vi.useRealTimers();
    if (store.getDatabase().open) store.close();
    ready.mockRestore();
    getPath.mockRestore();
    open.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
}

it('publishes the one opened store and clears the startup timer', async () => {
  await withStoreFixture(async ({ store, close, open, opening, runtime }) => {
    const first = runtime.initStore();
    const second = runtime.initStore();
    expect(open).toHaveBeenCalledOnce();
    opening.resolve(store);
    await expect(first).resolves.toBe(store);
    await expect(second).resolves.toBe(store);
    expect(runtime.getStore()).toBe(store);
    expect(
      store.getDatabase().prepare('SELECT count(*) FROM channel_session_mappings').pluck().get(),
    ).toBe(0);
    expect(runtime.getIMStore()).toBe(runtime.getIMStore());
    expect(vi.getTimerCount()).toBe(0);
    runtime.closeStore();
    expect(close).toHaveBeenCalledOnce();
    expect(store.getDatabase().open).toBe(false);
    expect(runtime.getStoreIfOpen()).toBeUndefined();
  });
});

it('closes a SQLite connection arriving after initialization timed out', async () => {
  await withStoreFixture(async ({ store, close, opening, runtime }) => {
    const failure = expect(runtime.initStore()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await failure;
    opening.resolve(store);
    await opening.promise;
    expect(close).toHaveBeenCalledOnce();
    expect(store.getDatabase().open).toBe(false);
    expect(() => runtime.getStore()).toThrow('not initialized');
  });
});

it('closes a connection that arrives during quit before publishing it', async () => {
  await withStoreFixture(async ({ store, close, opening, runtime, lifecycle }) => {
    const failure = expect(runtime.initStore()).rejects.toThrow('abandoned');
    lifecycle.isQuitting = true;
    opening.resolve(store);
    await failure;
    expect(close).toHaveBeenCalledOnce();
    expect(runtime.getStoreIfOpen()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('owns update checks across polling, resume and quit', async () => {
  await withStoreFixture(async ({ opening, store, runtime, lifecycle }) => {
    const init = runtime.initStore();
    opening.resolve(store);
    await init;
    const coordinator = runtime.getAppUpdateCoordinator();
    const success = { success: true, state: coordinator.getState(), updateFound: false };
    const check = vi.spyOn(coordinator, 'checkNow').mockResolvedValue(success);
    const shutdown = vi.spyOn(coordinator, 'shutdown');
    try {
      const initialTimerCount = vi.getTimerCount();
      runtime.startAppUpdatePolling();
      runtime.startAppUpdatePolling();
      expect(vi.getTimerCount()).toBe(initialTimerCount + 2);

      check.mockResolvedValueOnce({ ...success, success: false });
      runtime.checkForAppUpdateOnResume();
      await Promise.resolve();
      runtime.checkForAppUpdateOnResume();
      await Promise.resolve();
      expect(check).toHaveBeenCalledTimes(2);

      const checkedAt = Date.now();
      vi.setSystemTime(checkedAt + APP_UPDATE_POLL_INTERVAL_MS - 1);
      runtime.checkForAppUpdateOnResume();
      expect(check).toHaveBeenCalledTimes(2);

      vi.setSystemTime(checkedAt + APP_UPDATE_POLL_INTERVAL_MS);
      lifecycle.isQuitting = true;
      await runtime.shutdownAppUpdates();
      expect(vi.getTimerCount()).toBe(initialTimerCount);
      runtime.checkForAppUpdateOnResume();
      expect(check).toHaveBeenCalledTimes(2);
      expect(shutdown).toHaveBeenCalledOnce();
    } finally {
      await runtime.shutdownAppUpdates();
      coordinator.dispose();
    }
  });
});
