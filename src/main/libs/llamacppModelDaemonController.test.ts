import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findExecutable: vi.fn(),
  readRegistry: vi.fn(),
  spawn: vi.fn(),
  writeRegistry: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./llamacppModelDaemonRegistry', () => ({
  readLlamaCppModelDaemonRegistry: mocks.readRegistry,
  writeLlamaCppModelDaemonRegistry: mocks.writeRegistry,
}));
vi.mock('./llamacppGatewayCredentialVault', () => ({
  LlamaCppGatewayCredentialVault: class {
    ensureControlToken(): string {
      return 'test-control-token';
    }

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
import { LlamaCppModelDaemonCommand } from './llamacppModelDaemonProtocol';

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

describe('LlamaCppModelDaemonController', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mocks.findExecutable.mockReset();
    mocks.findExecutable.mockResolvedValue('C:/runtime/llama-server.exe');
    mocks.readRegistry.mockReset();
    mocks.readRegistry.mockResolvedValue(null);
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

  test('waits for daemon shutdown before restarting the gateway', async () => {
    mocks.spawn.mockReturnValueOnce(child(5001)).mockReturnValueOnce(child(5002));
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response());

    const controller = createController();
    await controller.listRunningModels();

    await expect(controller.restart({ port: '8080' })).resolves.toEqual(DAEMON_STATUS.status);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });

  test('reconnects before stopping an idle controller', async () => {
    mocks.readRegistry.mockResolvedValue(registry(18080, 4444));
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const controller = createController({ port: '8080', keepRunningOnAppQuit: false });

    await expect(controller.shutdownForQuit()).resolves.toBeUndefined();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
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

function createController(serviceConfig = { port: '8080' }): LlamaCppModelDaemonController {
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
  return {
    pid,
    kill: vi.fn(),
    once: vi.fn(),
    stderr: null,
    stdout: null,
    unref: vi.fn(),
  };
}

function registry(controlPort: number, pid: number) {
  return {
    version: 1 as const,
    pid,
    controlPort,
    gatewayPort: 8080,
    startedAt: '2026-09-29T00:00:00.000Z',
    models: [],
  };
}

function response() {
  return new Response(JSON.stringify({ success: true, status: DAEMON_STATUS }), { status: 200 });
}
