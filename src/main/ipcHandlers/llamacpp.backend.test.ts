import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import {
  LlamaCppBackendError,
  LlamaCppIpcChannel,
  LlamaCppOrchestrator,
} from '../../shared/llamacpp';
import { t } from '../i18n';
import {
  getLlamaCppBackendDir,
  getLlamaCppBackendExecutablePath,
  readCurrentBackendRef,
  syncCurrentBackend,
  toBackendRef,
} from '../libs/llamacppBackendManager';
import { BUILD_INFO_FILE } from '../libs/llamacppBackendManager/support';
import { LlamaCppManager } from '../libs/llamacppManager';
import { LlamaCppModelDaemonController } from '../libs/llamacppModelDaemonController';
import { LlamaCppRouterOrchestrator } from '../libs/llamacppRouterOrchestrator';
import { LLAMACPP_SERVICE_CONFIG_KEY } from './llamacpp/config';
import { registerLlamaCppIpcHandlers } from './llamacpp/registerHandlers';

const electron = vi.hoisted(() => ({
  userData: '',
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => electron.userData, getAppPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      electron.handlers.set(channel, handler),
  },
}));
vi.mock('../libs/llamacppBackendManager', async importOriginal => ({
  ...(await importOriginal<typeof import('../libs/llamacppBackendManager')>()),
  getLlamaCppBackendCompatibilityError: async () => undefined,
}));
vi.mock('../libs/llamacppNvidiaEnvironment', async importOriginal => ({
  ...(await importOriginal<typeof import('../libs/llamacppNvidiaEnvironment')>()),
  getLlamaCppNvidiaSnapshot: async () => null,
}));

test('shutdown waits for an admitted model directory change before releasing SQLite', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'llamacpp-shutdown-ipc-'));
  electron.userData = userData;
  const config = { orchestrator: LlamaCppOrchestrator.Daemon, parallel: '2' };
  const store = { get: () => config, set: vi.fn() };
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<null>();
  const readyToStop = Promise.withResolvers<void>();
  const processExit = Promise.withResolvers<void>();
  using stopDaemon = vi
    .spyOn(LlamaCppModelDaemonController.prototype, 'shutdownForQuit')
    .mockReturnValue(processExit.promise);
  using reconnect = vi
    .spyOn(LlamaCppModelDaemonController.prototype, 'reconnect')
    .mockImplementation(async options => {
      if (!options?.requireResponsive) return null;
      entered.resolve();
      return release.promise;
    });
  try {
    const manager = new LlamaCppManager(() => config, { resolveModel: vi.fn() });
    const inference = registerLlamaCppIpcHandlers(manager, { getStore: () => store as never });
    const setModelsDir = electron.handlers.get(LlamaCppIpcChannel.SetModelsDir)!;
    const changing = setModelsDir({}, path.join(userData, 'next-models'));
    await entered.promise;
    expect(reconnect).toHaveBeenCalledWith({ requireResponsive: true });
    const closed = vi.fn();
    const shutdown = inference.shutdownForQuit(readyToStop.promise);
    const drained = shutdown.drained.then(closed);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(closed).not.toHaveBeenCalled();
    const getConfig = electron.handlers.get(LlamaCppIpcChannel.GetServiceConfig)!;
    await expect(getConfig({})).rejects.toThrow(t('llamacppLoadModelServiceUnavailable'));
    expect(stopDaemon).not.toHaveBeenCalled();
    readyToStop.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(stopDaemon).toHaveBeenCalledOnce();
    expect(closed).not.toHaveBeenCalled();
    release.resolve(null);
    await Promise.all([changing, drained]);
    const stopped = vi.fn();
    void shutdown.stopped.then(stopped);
    await Promise.resolve();
    expect(stopped).not.toHaveBeenCalled();
    expect(store.set).toHaveBeenCalledWith(
      LLAMACPP_SERVICE_CONFIG_KEY,
      expect.objectContaining({ modelsDir: path.join(userData, 'next-models') }),
    );
    expect(store.set).toHaveBeenCalledBefore(closed);
    processExit.resolve();
    await shutdown.stopped;
  } finally {
    release.resolve(null);
    readyToStop.resolve();
    processExit.resolve();
    electron.handlers.clear();
    await rm(userData, { recursive: true, force: true });
  }
});

test.each([
  {
    owner: LlamaCppOrchestrator.Router,
    channel: LlamaCppIpcChannel.InstallBackend,
    busy: false,
  },
  { owner: LlamaCppOrchestrator.Daemon, channel: LlamaCppIpcChannel.InstallBackend, busy: false },
  { owner: LlamaCppOrchestrator.Router, channel: LlamaCppIpcChannel.InstallBackend, busy: true },
  {
    owner: LlamaCppOrchestrator.Router,
    channel: LlamaCppIpcChannel.InstallBackend,
    busy: 'transition',
  },
])('$channel uses the selected $owner owner (busy: $busy)', async ({ owner, channel, busy }) => {
  const userData = await mkdtemp(path.join(tmpdir(), 'llamacpp-backend-ipc-'));
  electron.userData = userData;
  const root = path.join(userData, 'llamacpp-runtime');
  const previous = toBackendRef('b11111', 'cpu');
  const next = toBackendRef('b22222', 'cpu');
  const config = { orchestrator: owner, parallel: '2' };
  const store = {
    get: (key: string) => (key === LLAMACPP_SERVICE_CONFIG_KEY ? config : undefined),
  };
  const manager = new LlamaCppManager(() => config, { resolveModel: vi.fn() });
  const prototype =
    owner === LlamaCppOrchestrator.Router
      ? LlamaCppRouterOrchestrator.prototype
      : LlamaCppModelDaemonController.prototype;
  const running = { status: 'running', checkedAt: new Date().toISOString() } as const;
  const reconnect = vi.spyOn(prototype, 'reconnect').mockResolvedValue({
    status: running,
    runningModels: [],
    modelProcesses:
      busy === true ? [{ modelName: 'loading', modelPath: 'fixture.gguf', port: 12345 }] : [],
    gatewayBaseUrl: null,
  });
  const stop = vi.spyOn(prototype, 'stopService').mockImplementation(async () => {
    expect(readCurrentBackendRef(root)).toMatchObject(previous);
  });
  const start = vi.spyOn(prototype, 'start').mockImplementation(async () => {
    expect(readCurrentBackendRef(root)).toMatchObject(next);
    return running;
  });
  try {
    for (const ref of [previous, next]) {
      const executable = getLlamaCppBackendExecutablePath(root, ref, process.platform);
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, '');
      const packageDir = getLlamaCppBackendDir(root, ref);
      await writeFile(path.join(packageDir, BUILD_INFO_FILE), JSON.stringify(ref));
    }
    syncCurrentBackend(root, previous);
    registerLlamaCppIpcHandlers(manager, { getStore: () => store as never });
    if (busy === 'transition') {
      const gate = Promise.withResolvers<typeof running>();
      using restart = vi.spyOn(prototype, 'restart').mockReturnValue(gate.promise);
      const restarting = electron.handlers.get(LlamaCppIpcChannel.Restart)!({});
      const result = await electron.handlers.get(channel)!({}, next);
      gate.resolve(running);
      await restarting;
      expect(restart).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        success: false,
        error: LlamaCppBackendError.SwitchRequiresStoppedService,
      });
      expect(readCurrentBackendRef(root)).toMatchObject(previous);
      expect(start).not.toHaveBeenCalled();
      return;
    }
    const result = await electron.handlers.get(channel)!({}, next);
    expect(reconnect).toHaveBeenCalledWith({ requireResponsive: true });
    if (busy) {
      expect(result).toMatchObject({
        success: false,
        error: LlamaCppBackendError.SwitchRequiresStoppedService,
      });
      expect(readCurrentBackendRef(root)).toMatchObject(previous);
      expect(stop).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    } else {
      expect(result, JSON.stringify(result)).toMatchObject({ success: true });
      expect(stop).toHaveBeenCalledBefore(start);
      expect(readCurrentBackendRef(root)).toMatchObject(next);
    }
  } finally {
    vi.restoreAllMocks();
    electron.handlers.clear();
    await rm(userData, { recursive: true, force: true });
  }
});

test('Magpie binding reads reject stale daemon snapshots across restart', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'llamacpp-binding-restart-'));
  electron.userData = userData;
  const runningModelSnapshot = {
    status: { status: 'running', managedByApp: true, checkedAt: new Date(0).toISOString() },
    runningModels: [{ name: 'qwen-local', status: 'loaded', runtime_context_length: 8192 }],
    modelProcesses: [],
    gatewayBaseUrl: 'http://127.0.0.1:8080',
  } satisfies Awaited<ReturnType<LlamaCppModelDaemonController['reconnect']>>;
  const manager = {
    on: vi.fn(() => manager),
    getModelsDir: vi.fn(() => '/tmp/models'),
  } as unknown as LlamaCppManager;
  const store = {
    get: vi.fn(() => ({ orchestrator: LlamaCppOrchestrator.Daemon })),
    set: vi.fn(),
  };
  const prototype = LlamaCppModelDaemonController.prototype;
  const next = { ...runningModelSnapshot, gatewayBaseUrl: 'http://127.0.0.1:8081' };
  const reconnect = vi.spyOn(prototype, 'reconnect').mockResolvedValue(runningModelSnapshot);
  const prior = Promise.withResolvers<typeof runningModelSnapshot>();
  const restarting = Promise.withResolvers<void>();
  const finishRestart = Promise.withResolvers<void>();
  const restart = vi.spyOn(prototype, 'restart').mockImplementation(async () => {
    restarting.resolve();
    await finishRestart.promise;
    reconnect.mockResolvedValue(next);
    return next.status;
  });
  const changed = vi.fn();
  try {
    const runtime = registerLlamaCppIpcHandlers(manager, {
      getStore: () => store as never,
      onModelBindingsChanged: changed,
    });
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    reconnect.mockReturnValueOnce(prior.promise);
    const staleRead = runtime.readModelBindings();
    const transition = electron.handlers.get(LlamaCppIpcChannel.Restart)!({});
    await restarting.promise;
    await expect(runtime.readModelBindings()).resolves.toEqual({ baseUrl: null, models: [] });
    finishRestart.resolve();
    await transition;
    expect(changed).toHaveBeenLastCalledWith(next.gatewayBaseUrl, [
      expect.objectContaining({ id: 'qwen-local' }),
    ]);
    prior.resolve(runningModelSnapshot);
    await expect(staleRead).resolves.toEqual({ baseUrl: null, models: [] });
    await expect(runtime.readModelBindings()).resolves.toMatchObject({
      baseUrl: next.gatewayBaseUrl,
    });
  } finally {
    prior.resolve(runningModelSnapshot);
    finishRestart.resolve();
    reconnect.mockRestore();
    restart.mockRestore();
    electron.handlers.clear();
    await rm(userData, { recursive: true, force: true });
  }
});
