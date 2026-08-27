import { expect, test } from 'vitest';
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

  await expect(completion).resolves.toMatchObject({ exitCode: 0 });
  expect(output.join('')).toContain('signed in');
});
