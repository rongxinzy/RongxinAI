import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { stopOwnedProcess, terminateProcessTree } from './ownedProcessStop';

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
  await stopOwnedProcess(child as unknown as ChildProcess);
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
  await stopOwnedProcess(child as unknown as ChildProcess);
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
  await expect(stopOwnedProcess(child as unknown as ChildProcess)).rejects.toThrow('EPERM');
  expect(child.listenerCount('exit')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(['ESRCH', 'EPERM'])('rechecks a Darwin group after transient EPERM (%s)', async code => {
  const child = Object.assign(makeChild(), { pid: 42, exitCode: 0 });
  const kill = vi
    .spyOn(process, 'kill')
    .mockImplementationOnce(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    })
    .mockImplementationOnce(() => {
      throw Object.assign(new Error(code), { code });
    });
  try {
    const stopped = terminateProcessTree(child, { platform: 'darwin' });
    if (code === 'ESRCH') await expect(stopped).resolves.toBeUndefined();
    else await expect(stopped).rejects.toThrow('EPERM');
    expect(kill.mock.calls).toEqual([
      [-42, 'SIGKILL'],
      [-42, 'SIGKILL'],
    ]);
  } finally {
    kill.mockRestore();
  }
});
