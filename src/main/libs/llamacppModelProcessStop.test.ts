import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { stopLlamaCppModelProcess } from './llamacppModelProcessStop';

function makeChild() {
  return Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn((_signal?: NodeJS.Signals) => true),
  });
}
afterEach(() => {
  vi.useRealTimers();
});

test('already exited child is not signalled', async () => {
  const child = makeChild();
  child.exitCode = 0;
  await stopLlamaCppModelProcess(child as unknown as ChildProcess);
  expect(child.kill).not.toHaveBeenCalled();
});

test('synchronous exit during signal is observed and clears the timer', async () => {
  vi.useFakeTimers();
  const child = makeChild();
  child.kill.mockImplementation(() => {
    child.exitCode = 0;
    child.emit('exit', 0, null);
    return true;
  });
  await stopLlamaCppModelProcess(child as unknown as ChildProcess);
  expect(child.kill).toHaveBeenCalledTimes(1);
  expect(child.listenerCount('exit')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test('signalling error rejects with no leaked listener or timer', async () => {
  vi.useFakeTimers();
  const child = makeChild();
  child.kill.mockImplementation(() => {
    throw new Error('EPERM');
  });
  await expect(stopLlamaCppModelProcess(child as unknown as ChildProcess)).rejects.toThrow('EPERM');
  expect(child.listenerCount('exit')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
