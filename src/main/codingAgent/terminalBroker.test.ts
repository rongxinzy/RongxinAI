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
  broker.release(result.id);
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
  broker.release(result.id);
});
