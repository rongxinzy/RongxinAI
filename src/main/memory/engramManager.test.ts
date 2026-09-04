import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import { resolveEngramBinary } from './binaryResolver';
import { EngramEnvironment, EngramManagerPhase } from './constants';
import { EngramManager } from './engramManager';

class FakeProcess extends EventEmitter {
  pid = 42;
  kill = vi.fn(() => true);
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
    // Windows: the engram child (stdio: 'ignore') may still hold SQLite file
    // handles briefly after stop() — retry after a short real-time pause
    // before giving up on cleanup.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        fs.rmSync(directory, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        const delay = (attempt + 1) * 100;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      }
    }
  }
});

test('starts the supervised runtime with private storage and launch credentials', async () => {
  const child = new FakeProcess();
  const spawnProcess = vi.fn(() => child);
  const close = vi.fn(async () => undefined);
  const manager = new EngramManager({
    userDataPath: createUserDataDirectory(),
    env: {},
    fileExists: () => true,
    projectRoot: path.resolve('project'),
    reservePort: async () => 43123,
    createProxy: async ({ token }) => ({ url: 'http://127.0.0.1:43124', close, token }),
    spawnProcess,
    checkHealth: async () => true,
  });

  const connection = await manager.start();
  const [, childEnvironment] = spawnProcess.mock.calls[0];

  expect(connection?.url).toBe('http://127.0.0.1:43124');
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
  expect(close).toHaveBeenCalledOnce();
  expect(child.kill).toHaveBeenCalledOnce();
});

test('does not expose a connection before the runtime health check passes', async () => {
  const child = new FakeProcess();
  const spawnProcess = vi.fn(() => child);
  const close = vi.fn(async () => undefined);
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
    createProxy: async () => ({ url: 'http://127.0.0.1:43124', close }),
    spawnProcess,
    checkHealth: () => healthCheck,
  });

  const startPromise = manager.start();
  await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
  expect(manager.getConnection()).toBeNull();

  resolveHealth(true);
  await expect(startPromise).resolves.toMatchObject({ url: 'http://127.0.0.1:43124' });
  expect(manager.getConnection()).toMatchObject({ url: 'http://127.0.0.1:43124' });

  await manager.stop();
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
    createProxy: async () => ({ url: 'http://127.0.0.1:43124', close: async () => undefined }),
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
