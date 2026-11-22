import { expect, test } from 'vitest';
import { execPath } from 'process';

import { TerminalBroker } from './terminalBroker';

test('captures output and preserves process exit status', async () => {
  const broker = new TerminalBroker();
  const result = await broker.run({
    command: execPath,
    args: ['-e', "process.stdout.write('ok'); process.exit(3)"],
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  });
  expect(result.output).toBe('ok');
  expect(result.exitCode).toBe(3);
  expect(result.signal).toBeNull();
  await broker.release(result.id);
});

test('retains the latest UTF-8-safe output within an ACP-requested limit', async () => {
  const broker = new TerminalBroker();
  const result = await broker.run({
    command: execPath,
    args: ['-e', "process.stdout.write('0123456789')"],
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
    outputByteLimit: 4,
  });
  expect(result.output).toBe('6789');
  expect(result.truncated).toBe(true);
  await broker.release(result.id);
});

test.skipIf(process.platform === 'win32').each(['kill', 'release', 'dispose'] as const)(
  '%s reaps an ACP terminal and its subprocess',
  async action => {
    const broker = new TerminalBroker();
    const terminal = broker.start({
      command: execPath,
      args: [
        '-e',
        `const { spawn } = require('node:child_process');
        spawn(process.execPath, ['-e', 'console.log(process.ppid, process.pid); setInterval(() => {}, 1000)'],
          { stdio: 'inherit' });
        setInterval(() => {}, 1000);`,
      ],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });
    const exited = broker.wait(terminal.id);
    try {
      await expect.poll(() => terminal.output.trim()).toMatch(/^\d+ \d+$/);
      const [, descendant] = terminal.output.trim().split(' ').map(Number);
      const stop = action === 'dispose' ? broker.dispose() : broker[action](terminal.id);
      await stop;
      await expect.poll(() => terminal.signal).toBe('SIGTERM');
      await expect.poll(() => processExists(descendant)).toBe(false);
      await expect(exited).resolves.toMatchObject({ signal: 'SIGTERM' });
      if (action === 'kill') expect(broker.output(terminal.id)).toBe(terminal);
      else expect(broker.output(terminal.id)).toBeNull();
    } finally {
      const pids = terminal.output.trim().split(' ').map(Number);
      for (const pid of pids.reverse()) {
        if (pid > 0 && processExists(pid)) process.kill(pid, 'SIGKILL');
      }
      await broker.dispose();
    }
  },
);

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}
