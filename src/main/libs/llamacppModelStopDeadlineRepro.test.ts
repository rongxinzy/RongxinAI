import { EventEmitter } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), release: vi.fn(), releaseAll: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./llamacppModelPortAllocator', () => ({
  LlamaCppModelPortAllocator: class {
    reserve = vi.fn(async () => ({ modelName: 'test', port: 18081 }));
    release = mocks.release;
    releaseAll = mocks.releaseAll;
  },
}));
vi.mock('./llamacppServe', () => ({
  buildLlamaCppServeEnv: () => ({}),
  buildLlamaServerModelArgs: () => [],
}));
import { LlamaCppModelProcessManager } from './llamacppModelProcessManager';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('retains a TERM-resistant model until confirmed exit and shares concurrent stops', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => true),
  });
  mocks.spawn.mockReturnValue(child);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true })),
  );
  const manager = new LlamaCppModelProcessManager({
    getExecutablePath: async () => '/mock/llama-server',
    getServiceConfig: () => ({}),
    startupTimeoutMs: () => 1000,
  });
  await manager.ensureRunning({ model: 'test', modelPath: '/mock/test.gguf' });
  const first = manager.stop('test');
  const concurrent = manager.stopAll();
  expect(manager.list()).toHaveLength(1);
  expect(mocks.release).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  child.emit('exit', null, 'SIGKILL');
  await Promise.all([first, concurrent]);
  expect(manager.list()).toEqual([]);
  expect(child.listenerCount('exit')).toBe(0);
  expect(mocks.release).toHaveBeenCalledExactlyOnceWith('test');
  expect(mocks.releaseAll).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test('failed termination stays tracked and can be retried', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => false),
  });
  mocks.spawn.mockReturnValue(child);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true })),
  );
  const manager = new LlamaCppModelProcessManager({
    getExecutablePath: async () => '/mock/llama-server',
    getServiceConfig: () => ({}),
    startupTimeoutMs: () => 1000,
  });
  await manager.ensureRunning({ model: 'test', modelPath: '/mock/test.gguf' });
  const failure = expect(manager.stop('test')).rejects.toThrow('did not exit');
  await vi.advanceTimersByTimeAsync(2000);
  await failure;
  expect(manager.list()).toHaveLength(1);
  expect(mocks.release).not.toHaveBeenCalled();
  expect(child.listenerCount('exit')).toBe(1); // manager ownership only
  const retry = manager.stop('test');
  child.emit('exit', 0, null);
  await retry;
  expect(manager.list()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});
