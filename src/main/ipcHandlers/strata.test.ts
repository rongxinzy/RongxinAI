import { BrowserWindow, ipcMain } from 'electron';
import { afterEach, expect, test, vi } from 'vitest';

import { StrataIpcChannel } from '../../shared/strata/constants';
import { StrataManager } from '../libs/strata/strataManager';
import type { StrataProviderSnapshot } from '../magpie/strataProviderBinding';
import type { SqliteStore } from '../sqliteStore';
import { registerStrataIpcHandlers } from './strata';

const strataClientMock = vi.hoisted(() => ({
  health: vi.fn(async () => true),
  listModels: vi.fn(async () => [{ id: 'strata-model', name: 'Strata Model' }]),
}));

vi.mock('../libs/strata/strataClient', () => ({
  StrataClient: class {
    health = strataClientMock.health;
    listModels = strataClientMock.listModels;
  },
}));

vi.mock('../libs/strata/strataEditionPolicy', () => ({
  isStrataFeatureEnabled: () => true,
}));

vi.mock('../libs/strata/strataBundledManifest', () => ({
  readStrataBundledManifest: () => ({
    schemaVersion: 1,
    releaseTag: 'test',
    defaultPort: 8096,
    runtimeRoot: 'runtime',
    componentsRoot: 'components',
    pythonExecutable: 'python.exe',
    engineQwenFolder: 'qwen',
    engineDsv41Folder: 'dsv41',
    sha256: { python: '', strata: '', strataDsv41: '' },
    attribution: '',
  }),
  resolveStrataBundledRoot: () => 'C:\\fake-strata',
  resolveStrataDefaultPort: () => 8096,
}));

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

afterEach(() => {
  vi.restoreAllMocks();
});

test('a running status event refreshes bindings without re-probing the service', async () => {
  const handlers = new Map<string, IpcHandler>();
  vi.spyOn(ipcMain, 'handle').mockImplementation((channel, listener) => {
    handlers.set(channel, listener as unknown as IpcHandler);
  });
  const broadcasts: unknown[] = [];
  vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([
    {
      isDestroyed: () => false,
      webContents: {
        send: (_channel: string, payload: unknown) => {
          broadcasts.push(payload);
        },
      },
    },
  ] as never);

  const manager = new StrataManager(() => ({ port: '8096' }));
  const snapshots: StrataProviderSnapshot[] = [];
  registerStrataIpcHandlers(manager, {
    getStore: () =>
      ({
        get: () => ({}),
        set: () => {},
      }) as unknown as SqliteStore,
    onModelBindingsChanged: snapshot => {
      snapshots.push(snapshot);
    },
  });

  const statusHandler = handlers.get(StrataIpcChannel.Status);
  expect(statusHandler).toBeDefined();
  await statusHandler!({});

  await vi.waitFor(() => expect(snapshots).toHaveLength(1));
  // Allow any self-triggered refresh chain to run; the fixed code stops probing.
  await new Promise(resolve => setTimeout(resolve, 50));

  expect(strataClientMock.health).toHaveBeenCalledTimes(1);
  expect(strataClientMock.listModels).toHaveBeenCalledTimes(1);
  expect(broadcasts).toHaveLength(1);
  expect(snapshots[0]).toEqual({
    baseUrl: 'http://127.0.0.1:8096/v1',
    models: [{ id: 'strata-model', name: 'Strata Model', input: ['text'] }],
  });
});

test('a delayed model list cannot restore bindings after the service stops', async () => {
  vi.spyOn(ipcMain, 'handle').mockImplementation(() => {});
  vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([]);
  let resolveModels: (models: { id: string; name: string }[]) => void = () => {};
  strataClientMock.health.mockResolvedValue(true);
  strataClientMock.listModels.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveModels = resolve;
      }),
  );
  const manager = new StrataManager(() => ({ port: '8096' }));
  const snapshots: StrataProviderSnapshot[] = [];
  registerStrataIpcHandlers(manager, {
    getStore: () => ({ get: () => ({}), set: () => {} }) as unknown as SqliteStore,
    onModelBindingsChanged: snapshot => {
      snapshots.push(snapshot);
    },
  });

  await manager.detect();
  await manager.stop();
  expect(snapshots.at(-1)).toEqual({ baseUrl: null, models: [] });
  resolveModels([{ id: 'stale-model', name: 'Stale Model' }]);
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(snapshots.at(-1)).toEqual({ baseUrl: null, models: [] });
});
