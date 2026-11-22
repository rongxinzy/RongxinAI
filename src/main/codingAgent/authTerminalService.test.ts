import { expect, test, vi } from 'vitest';
import type { IPty } from 'node-pty';

import { AuthTerminalService } from './authTerminalService';

test('keeps terminal authentication output outside the ACP stdio transport', async () => {
  const service = new AuthTerminalService((() => {
    let onData: ((data: string) => void) | undefined;
    return {
      write: () => undefined,
      resize: () => undefined,
      kill: () => undefined,
      onData: callback => {
        onData = callback;
        return { dispose: () => undefined };
      },
      onExit: callback => {
        queueMicrotask(() => {
          onData?.('signed in');
          callback({ exitCode: 0, signal: 0 });
        });
        return { dispose: () => undefined };
      },
    } as unknown as IPty;
  }) as typeof import('node-pty').spawn);
  const output: string[] = [];
  const completion = new Promise<{ exitCode: number }>(resolve => {
    service.on('exit', event => resolve(event));
  });
  service.on('data', event => output.push(event.data));

  service.start({
    profileId: 'agent',
    methodId: 'terminal-login',
    executable: '/agent',
    baseArgs: ['login'],
    authArgs: [],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });

  await expect(completion).resolves.toMatchObject({
    exitCode: 0,
    workspaceRoot: process.cwd(),
  });
  expect(output.join('')).toContain('signed in');
});

test('disposal does not publish a login result from a stopped terminal', () => {
  let exited: ((event: { exitCode: number; signal?: number }) => void) | undefined;
  const kill = vi.fn(() => exited?.({ exitCode: 0 }));
  const service = new AuthTerminalService((() => ({
    kill,
    onData: () => ({ dispose: () => undefined }),
    onExit: (callback: typeof exited) => {
      exited = callback;
      return { dispose: () => undefined };
    },
  })) as typeof import('node-pty').spawn);
  const notify = vi.fn();
  service.on('exit', notify);
  service.start({
    profileId: 'agent',
    methodId: 'login',
    executable: '/agent',
    baseArgs: [],
    authArgs: [],
    cwd: process.cwd(),
    environment: {},
  });

  service.dispose();

  expect(kill).toHaveBeenCalledOnce();
  expect(notify).not.toHaveBeenCalled();
});
