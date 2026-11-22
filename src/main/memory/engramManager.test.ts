import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import { resolveEngramBinary } from './binaryResolver';
import { EngramEnvironment, EngramManagerPhase } from './constants';
import { EngramManager } from './engramManager';
import { ZhiYuanEngramAdapter } from './zhiyuanEngramAdapter';

class FakeProcess extends EventEmitter {
  pid = 42;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn((signal: NodeJS.Signals) => {
    this.signalCode = signal;
    this.emit('exit', null, signal);
    return true;
  });
}

const temporaryDirectories: string[] = [];

function createUserDataDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-memory-manager-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('starts the supervised runtime with private storage and launch credentials', async () => {
  const child = new FakeProcess();
  const spawnProcess = vi.fn(() => child);
  const manager = new EngramManager({
    userDataPath: createUserDataDirectory(),
    env: {},
    fileExists: () => true,
    projectRoot: path.resolve('project'),
    reservePort: async () => 43123,
    spawnProcess,
    checkHealth: async () => true,
  });

  const connection = await manager.start();
  const [, childEnvironment] = spawnProcess.mock.calls[0];

  expect(connection?.url).toBe('http://127.0.0.1:43123');
  expect(connection?.token).toHaveLength(64);
  expect(
    childEnvironment[EngramEnvironment.DataDirectory]?.endsWith(path.join('memory', 'engram')),
  ).toBe(true);
  expect(childEnvironment[EngramEnvironment.Port]).toBe('43123');
  expect(childEnvironment[EngramEnvironment.HttpToken]).toBe(connection?.token);
  expect(manager.getStatus()).toMatchObject({
    phase: EngramManagerPhase.Running,
    available: true,
  });

  await manager.stop();
  expect(child.kill).toHaveBeenCalledOnce();
});

test('does not expose a connection before the runtime health check passes', async () => {
  const child = new FakeProcess();
  const spawnProcess = vi.fn(() => child);
  let resolveHealth!: (healthy: boolean) => void;
  const healthCheck = new Promise<boolean>(resolve => {
    resolveHealth = resolve;
  });
  const manager = new EngramManager({
    userDataPath: createUserDataDirectory(),
    env: {},
    fileExists: () => true,
    projectRoot: path.resolve('project'),
    reservePort: async () => 43123,
    spawnProcess,
    checkHealth: () => healthCheck,
  });

  const startPromise = manager.start();
  await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
  expect(manager.getStatus()).toMatchObject({
    phase: EngramManagerPhase.Starting,
    available: false,
  });
  expect(manager.start()).toBe(startPromise);

  resolveHealth(true);
  await expect(startPromise).resolves.toMatchObject({ url: 'http://127.0.0.1:43123' });
  await expect(manager.start()).resolves.toMatchObject({ url: 'http://127.0.0.1:43123' });
  expect(spawnProcess).toHaveBeenCalledOnce();

  await manager.stop();
});

test('stopping during port reservation prevents a late sidecar spawn', async () => {
  const port = Promise.withResolvers<number>();
  const spawnProcess = vi.fn(() => new FakeProcess());
  const manager = new EngramManager({
    userDataPath: createUserDataDirectory(),
    env: {},
    fileExists: () => true,
    projectRoot: path.resolve('project'),
    reservePort: () => port.promise,
    spawnProcess,
    checkHealth: async () => true,
  });
  const starting = manager.start();
  await manager.stop();
  port.resolve(43123);
  await expect(starting).resolves.toBeNull();
  expect(spawnProcess).not.toHaveBeenCalled();
  expect(manager.getStatus().phase).toBe(EngramManagerPhase.Stopped);
});

test('a late memory read cannot reopen the stopped runtime', async () => {
  const spawnProcess = vi.fn(() => new FakeProcess());
  const manager = new EngramManager({
    userDataPath: createUserDataDirectory(),
    env: {},
    fileExists: () => true,
    projectRoot: path.resolve('project'),
    reservePort: async () => 43123,
    spawnProcess,
    checkHealth: async () => true,
  });
  await manager.start();
  await manager.stop();

  const adapter = new ZhiYuanEngramAdapter(manager);
  await expect(adapter.recall({ query: 'late read', project: 'project' })).resolves.toEqual([]);
  expect(spawnProcess).toHaveBeenCalledOnce();
  expect(manager.getStatus().phase).toBe(EngramManagerPhase.Stopped);
});

test('degrades without preventing the app from running when the binary is missing', async () => {
  const manager = new EngramManager({
    userDataPath: createUserDataDirectory(),
    env: {},
    fileExists: () => false,
  });

  await expect(manager.start()).resolves.toBeNull();
  expect(manager.getStatus()).toMatchObject({
    phase: EngramManagerPhase.Degraded,
    available: false,
  });
});

test('restarts after an unexpected process exit', async () => {
  vi.useFakeTimers();
  const children = [new FakeProcess(), new FakeProcess()];
  const spawnProcess = vi.fn(() => children.shift() ?? new FakeProcess());
  const manager = new EngramManager({
    userDataPath: createUserDataDirectory(),
    env: {},
    fileExists: () => true,
    projectRoot: path.resolve('project'),
    reservePort: async () => 43123,
    spawnProcess,
    checkHealth: async () => true,
    restartDelaysMs: [1],
  });
  await manager.start();

  (spawnProcess.mock.results[0].value as FakeProcess).emit('exit', 1);
  await vi.advanceTimersByTimeAsync(1);

  expect(spawnProcess).toHaveBeenCalledTimes(2);
  expect(manager.getStatus().phase).toBe(EngramManagerPhase.Running);
  await manager.stop();
});

test('keeps ownership of an unhealthy child until exit before starting a replacement', async () => {
  vi.useFakeTimers();
  const child = new FakeProcess();
  child.kill.mockImplementation(() => true);
  const spawnProcess = vi.fn(() => new FakeProcess()).mockReturnValueOnce(child);
  const checkHealth = vi.fn(async () => false);
  const manager = new EngramManager({
    userDataPath: createUserDataDirectory(),
    env: {},
    fileExists: () => true,
    projectRoot: path.resolve('project'),
    reservePort: async () => 43123,
    spawnProcess,
    checkHealth,
    restartDelaysMs: [1],
  });
  const initial = manager.start();
  await vi.advanceTimersByTimeAsync(10_100);
  expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
  await expect(manager.start()).resolves.toBeNull();
  expect(spawnProcess).toHaveBeenCalledOnce();

  child.emit('exit', null, 'SIGTERM');
  await expect(initial).resolves.toBeNull();
  checkHealth.mockResolvedValue(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(spawnProcess).toHaveBeenCalledTimes(2);
  expect(manager.getStatus().phase).toBe(EngramManagerPhase.Running);
  await manager.stop();
});

test.skipIf(process.platform === 'win32')(
  'waits for the owned child to exit even when it ignores SIGTERM',
  async () => {
    const child = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);"],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const kill = vi.spyOn(child, 'kill');
    const exited = once(child, 'exit');
    try {
      await once(child.stdout, 'data');
      const manager = new EngramManager({
        userDataPath: createUserDataDirectory(),
        env: {},
        fileExists: () => true,
        projectRoot: path.resolve('project'),
        reservePort: async () => 43123,
        spawnProcess: () => child,
        checkHealth: async () => true,
      });
      await manager.start();
      const stopping = Promise.all([manager.stop(), manager.stop()]);
      expect(manager.getStatus().phase).toBe(EngramManagerPhase.Stopping);
      await expect(manager.start()).resolves.toBeNull();
      await stopping;
      expect(child.signalCode).toBe('SIGKILL');
      expect(kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
      expect(manager.getStatus().phase).toBe(EngramManagerPhase.Stopped);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  },
);

test('integration: starts the vendored binary end-to-end when one exists', async () => {
  // The vendored runtime is a build-time artifact (vendor/engram-runtime/current),
  // downloaded by scripts/download-engram-runtime.cjs and absent in a clean checkout.
  // Skip when the binary is not installed so CI without the artifact stays green.
  const binary = resolveEngramBinary({
    env: {},
    projectRoot: path.resolve(__dirname, '..', '..', '..'),
    fileExists: fs.existsSync,
  });
  if (!binary) {
    console.warn(
      '[verify] No vendored engram binary found — skipping live integration test. ' +
        'Run `npm run engram:runtime:host` to install it.',
    );
    return;
  }

  const userDataPath = createUserDataDirectory();
  const manager = new EngramManager({
    userDataPath,
    projectRoot: path.resolve(__dirname, '..', '..', '..'),
  });

  const connection = await manager.start();
  expect(connection).not.toBeNull();
  expect(connection!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(connection!.token).toHaveLength(64);
  expect(manager.getStatus().phase).toBe(EngramManagerPhase.Running);

  // The launch token must be required by the loopback health endpoint.
  const health = await fetch(`${connection!.url}/health`, {
    headers: { Authorization: `Bearer ${connection!.token}` },
    signal: AbortSignal.timeout(3_000),
  });
  expect(health.ok).toBe(true);

  // The runtime must own a private SQLite store under userData/memory/engram.
  const dataDirectory = path.join(userDataPath, 'memory', 'engram');
  expect(
    fs.readdirSync(dataDirectory).some(entry => entry.endsWith('.db') || entry.endsWith('.sqlite')),
  ).toBe(true);

  await manager.stop();
  expect(manager.getStatus().phase).toBe(EngramManagerPhase.Stopped);
}, 30_000);
