import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

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
    fs.rmSync(directory, { recursive: true, force: true });
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
