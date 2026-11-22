import { EventEmitter } from 'node:events';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { LlamaCppServiceConfig } from '../../shared/llamacpp';

const mocks = vi.hoisted(() => ({
  findExecutable: vi.fn(),
  readRegistry: vi.fn(),
  removeRegistry: vi.fn(),
  spawn: vi.fn(),
  writeRegistry: vi.fn(),
  readControlToken: vi.fn(() => 'test-control-token'),
  ensureControlToken: vi.fn(() => 'test-control-token'),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./llamacppModelDaemonRegistry', () => ({
  readLlamaCppModelDaemonRegistry: mocks.readRegistry,
  removeLlamaCppModelDaemonRegistry: mocks.removeRegistry,
  writeLlamaCppModelDaemonRegistry: mocks.writeRegistry,
}));
vi.mock('./llamacppGatewayCredentialVault', () => ({
  LlamaCppGatewayCredentialVault: class {
    readControlToken = mocks.readControlToken;
    ensureControlToken = mocks.ensureControlToken;

    ensureLanToken(): string {
      return 'test-lan-token';
    }

    getLanToken(): string {
      return 'test-lan-token';
    }

    regenerateLanToken(): string {
      return 'test-lan-token';
    }
  },
}));
vi.mock('./llamacppRuntimePaths', () => ({ findLlamaCppExecutable: mocks.findExecutable }));

import {
  formatLlamaCppDaemonStartupFailure,
  LlamaCppModelDaemonController,
  resolveLlamaCppModelDaemonEntryPath,
  resolveLlamaCppModelDaemonRequestTimeoutMs,
} from './llamacppModelDaemonController';
import {
  LlamaCppModelDaemonCommand,
  LLAMACPP_MODEL_DAEMON_HANDOFF,
} from './llamacppModelDaemonProtocol';

const DAEMON_STATUS = {
  status: { status: 'running' as const, managedByApp: true, checkedAt: '2026-09-29T00:00:00.000Z' },
  runningModels: [],
  modelProcesses: [],
  gatewayBaseUrl: 'http://127.0.0.1:8080/v1',
};

test('resolves the daemon entry beside the Electron main bundle', () => {
  expect(resolveLlamaCppModelDaemonEntryPath('C:/app/dist-electron')).toBe(
    path.join('C:/app/dist-electron', 'llamacppModelDaemonEntry.js'),
  );
});

test('includes daemon stderr and exit information in startup failures', () => {
  expect(
    formatLlamaCppDaemonStartupFailure({
      message: 'Failed to connect to daemon.',
      output: 'Error: module could not be loaded',
      exitCode: 1,
    }),
  ).toContain('daemon exited with code 1\nError: module could not be loaded');
});

test('resolves short and model-startup control request timeouts', () => {
  expect(
    resolveLlamaCppModelDaemonRequestTimeoutMs(LlamaCppModelDaemonCommand.EnsureModel, {
      timeout: '30',
    }),
  ).toBe(35_000);
  expect(
    resolveLlamaCppModelDaemonRequestTimeoutMs(LlamaCppModelDaemonCommand.Status, {
      timeout: '30',
    }),
  ).toBe(1_000);
});

test('allows bounded model cleanup to finish before stop control requests expire', () => {
  for (const command of [
    LlamaCppModelDaemonCommand.StopModel,
    LlamaCppModelDaemonCommand.StopAll,
  ]) {
    expect(resolveLlamaCppModelDaemonRequestTimeoutMs(command, {})).toBe(3000);
  }
});

describe('LlamaCppModelDaemonController', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mocks.readControlToken.mockClear();
    mocks.ensureControlToken.mockClear();
    mocks.findExecutable.mockReset();
    mocks.findExecutable.mockResolvedValue('C:/runtime/llama-server.exe');
    mocks.readRegistry.mockReset();
    mocks.readRegistry.mockResolvedValue(null);
    mocks.removeRegistry.mockReset();
    mocks.spawn.mockReset();
    mocks.writeRegistry.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('reuses an authenticated registered daemon before spawning a new one', async () => {
    mocks.readRegistry.mockResolvedValue(registry(18080, 4444));
    fetchMock.mockResolvedValue(response());

    const controller = createController();

    await expect(controller.listRunningModels()).resolves.toEqual([]);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18080/control',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('queries live model status without republishing the daemon identity', async () => {
    mocks.readRegistry.mockResolvedValue(registry(18080, 4444));
    fetchMock.mockImplementation(async () => response());
    const controller = createController();

    await expect(Promise.all([controller.reconnect(), controller.reconnect()])).resolves.toEqual([
      DAEMON_STATUS,
      DAEMON_STATUS,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.writeRegistry).not.toHaveBeenCalled();
  });

  test('a failed probe cannot report a live registered daemon as stopped during reconfiguration', async () => {
    mocks.readRegistry.mockResolvedValue(registry(18080, process.pid));
    fetchMock.mockRejectedValue(new Error('Fixture daemon probe timed out'));
    const controller = createController();

    await expect(controller.reconnect()).resolves.toBeNull();
    await expect(controller.reconnect({ requireResponsive: true })).rejects.toThrow(
      'probe timed out',
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  test('serializes concurrent startup requests into one daemon spawn', async () => {
    mocks.spawn.mockReturnValue(child(5001));
    fetchMock.mockResolvedValue(response());

    const controller = createController();

    await expect(
      Promise.all([controller.listRunningModels(), controller.listRunningModels()]),
    ).resolves.toEqual([[], []]);

    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.writeRegistry).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ pid: 5001, startedAt: expect.any(String) }),
    );
  });

  test('retries a timed-out probe and waits for a closed control port before restarting', async () => {
    mocks.spawn.mockReturnValueOnce(child(5001)).mockReturnValueOnce(child(5002));
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new DOMException('Probe timed out', 'TimeoutError'))
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response());

    const controller = createController();
    await controller.listRunningModels();

    await expect(controller.restart({ port: '8080' })).resolves.toEqual(DAEMON_STATUS.status);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.invocationCallOrder[3]).toBeLessThan(
      mocks.spawn.mock.invocationCallOrder[1],
    );
  });

  test('reconnects and sends only shutdown before confirming the control port closed', async () => {
    mocks.readRegistry.mockResolvedValue(registry(18080, 4444));
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }));

    const controller = createController({ port: '8080', keepRunningOnAppQuit: false });

    await expect(controller.shutdownForQuit()).resolves.toBeUndefined();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.readControlToken).toHaveBeenCalledOnce();
    expect(mocks.ensureControlToken).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).command)).toEqual([
      LlamaCppModelDaemonCommand.Status,
      LlamaCppModelDaemonCommand.Shutdown,
      LlamaCppModelDaemonCommand.Status,
    ]);
  });

  test.each([false, true])(
    'never spawns a pending daemon after quit (keep running: %s)',
    async keepRunningOnAppQuit => {
      const executable = Promise.withResolvers<string>();
      mocks.findExecutable.mockReturnValue(executable.promise);
      mocks.spawn.mockReturnValue(child(5001));
      let stopped = false;
      fetchMock.mockImplementation(async (_url, options: RequestInit) => {
        if (stopped) throw new TypeError('daemon stopped');
        if (JSON.parse(String(options.body)).command === LlamaCppModelDaemonCommand.Shutdown) {
          stopped = true;
        }
        return response();
      });
      const controller = createController({ port: '8080', keepRunningOnAppQuit });
      const starting = controller.ensureModel({ model: 'fixture' });
      await vi.waitFor(() => expect(mocks.findExecutable).toHaveBeenCalledOnce());

      const quitting = controller.shutdownForQuit();
      executable.resolve('/mock/llama-server');
      const [result] = await Promise.allSettled([starting, quitting]);

      expect(mocks.spawn.mock.calls.length).toBe(0);
      expect(result).toMatchObject({ status: 'rejected', reason: expect.any(Error) });
      await expect(controller.ensureModel({ model: 'later' })).rejects.toThrow('shutting down');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test('terminates only the spawned daemon when quit interrupts its readiness request', async () => {
    const daemon = child(5001);
    const readiness = Promise.withResolvers<Response>();
    const requestStarted = Promise.withResolvers<void>();
    mocks.spawn.mockReturnValue(daemon);
    let shuttingDown = false;
    fetchMock.mockImplementation((_url, options: RequestInit) => {
      const { command } = JSON.parse(String(options.body));
      if (shuttingDown) return Promise.reject(new Error('daemon stopped'));
      if (command === LlamaCppModelDaemonCommand.Shutdown) shuttingDown = true;
      if (command !== LlamaCppModelDaemonCommand.Status) return Promise.resolve(response());
      options.signal?.addEventListener('abort', () => readiness.reject(options.signal?.reason), {
        once: true,
      });
      requestStarted.resolve();
      return readiness.promise;
    });
    const controller = createController({ port: '8080', keepRunningOnAppQuit: false });
    const starting = controller.listRunningModels().catch((error: unknown) => error);
    await requestStarted.promise;

    const quitting = controller.shutdownForQuit();
    try {
      await expect.poll(() => daemon.kill.mock.calls).toEqual([['SIGTERM']]);
      await quitting;
      expect(await starting).toEqual(expect.any(Error));
      expect(mocks.writeRegistry).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(daemon.send).not.toHaveBeenCalled();
    } finally {
      readiness.resolve(response());
      await quitting;
    }
  });

  test('quits during registry publication without handing off the daemon or retaining its identity', async () => {
    const daemon = child(5001);
    const writeStarted = Promise.withResolvers<void>();
    const finishWrite = Promise.withResolvers<void>();
    mocks.spawn.mockReturnValue(daemon);
    fetchMock.mockImplementation(async () => response());
    mocks.writeRegistry.mockImplementation(async () => {
      writeStarted.resolve();
      await finishWrite.promise;
    });
    const controller = createController({ port: '8080', keepRunningOnAppQuit: false });
    const starting = controller.listRunningModels().catch((error: unknown) => error);
    await writeStarted.promise;

    const quitting = controller.shutdownForQuit();
    expect(daemon.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mocks.removeRegistry).not.toHaveBeenCalled();
    finishWrite.resolve();

    await quitting;
    expect(await starting).toEqual(expect.any(Error));
    expect(mocks.removeRegistry).toHaveBeenCalledWith(
      'C:/test-user-data',
      expect.objectContaining({
        pid: daemon.pid,
        controlPort: expect.any(Number),
        startedAt: expect.any(String),
      }),
    );
    expect(daemon.send).not.toHaveBeenCalled();
  });

  test('leaves an already spawned daemon running on quit when requested', async () => {
    const daemon = child(5001);
    const readiness = Promise.withResolvers<Response>();
    const requestStarted = Promise.withResolvers<void>();
    mocks.spawn.mockReturnValue(daemon);
    fetchMock.mockImplementation(() => {
      requestStarted.resolve();
      return readiness.promise;
    });
    const controller = createController({ port: '8080', keepRunningOnAppQuit: true });
    const starting = controller.listRunningModels();
    await requestStarted.promise;

    await controller.shutdownForQuit();
    expect(daemon.kill).not.toHaveBeenCalled();
    expect(daemon.send).not.toHaveBeenCalled();
    readiness.resolve(response());

    await expect(starting).resolves.toEqual([]);
    expect(mocks.writeRegistry).toHaveBeenCalledBefore(daemon.send);
    expect(daemon.send).toHaveBeenCalledWith(LLAMACPP_MODEL_DAEMON_HANDOFF);
    expect(daemon.send).toHaveBeenCalledBefore(daemon.disconnect);
    expect(daemon.kill).not.toHaveBeenCalled();
  });

  test('keeps a running daemon when requested, without dispatching newly queued model starts', async () => {
    mocks.readRegistry.mockResolvedValue(registry(18080, 4444));
    fetchMock.mockImplementation(async () => response());
    const controller = createController({ port: '8080', keepRunningOnAppQuit: true });
    await controller.reconnect();

    const delayedStatus = Promise.withResolvers<Response>();
    fetchMock.mockReturnValueOnce(delayedStatus.promise);
    const starting = controller.ensureModel({ model: 'fixture' });
    await controller.shutdownForQuit();
    delayedStatus.resolve(response());

    await expect(starting).rejects.toThrow('shutting down');
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).command)).toEqual([
      LlamaCppModelDaemonCommand.Status,
      LlamaCppModelDaemonCommand.Status,
    ]);
    expect(mocks.spawn.mock.calls.length).toBe(0);
  });

  test('confirms the port closed even when the shutdown response is lost', async () => {
    mocks.readRegistry.mockResolvedValue(registry(18080, 4444));
    fetchMock
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new TypeError('shutdown response lost'))
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }));
    const controller = createController({ port: '8080', keepRunningOnAppQuit: false });

    await expect(controller.shutdownForQuit()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).command)).toEqual([
      LlamaCppModelDaemonCommand.Status,
      LlamaCppModelDaemonCommand.Shutdown,
      LlamaCppModelDaemonCommand.Status,
    ]);
  });

  test('does not use a stale registry PID to terminate a process', async () => {
    const staleChild = child(4444);
    mocks.readRegistry.mockResolvedValueOnce(registry(18080, 4444)).mockResolvedValue(null);
    mocks.spawn.mockReturnValue(child(5001));
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue(response());

    const controller = createController();

    await expect(controller.listRunningModels()).resolves.toEqual([]);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(staleChild.kill).not.toHaveBeenCalled();
  });
});

function createController(
  serviceConfig: LlamaCppServiceConfig = { port: '8080' },
): LlamaCppModelDaemonController {
  const store = new Map<string, unknown>();
  return new LlamaCppModelDaemonController({
    userDataPath: 'C:/test-user-data',
    getStore: () => ({
      get: <T>(key: string) => store.get(key) as T | undefined,
      set: <T>(key: string, value: T) => store.set(key, value),
      delete: key => store.delete(key),
    }),
    getServiceConfig: () => serviceConfig,
  });
}

function child(pid: number) {
  const daemon = Object.assign(new EventEmitter(), {
    pid,
    connected: true,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn((signal: NodeJS.Signals) => {
      daemon.connected = false;
      daemon.signalCode = signal;
      daemon.emit('exit', null, signal);
      return true;
    }),
    send: vi.fn(),
    disconnect: vi.fn(() => {
      daemon.connected = false;
    }),
    stderr: null,
    stdout: null,
    unref: vi.fn(),
  });
  return daemon;
}

function registry(controlPort: number, pid: number) {
  return {
    pid,
    controlPort,
    startedAt: '2026-09-29T00:00:00.000Z',
  };
}

function response() {
  return new Response(JSON.stringify({ success: true, status: DAEMON_STATUS }), { status: 200 });
}
