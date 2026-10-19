import { expect, test } from 'vitest';

import { runCommandCapture, runScriptWithTimeout } from './processRunner';

// The parent spawns a grandchild that inherits stdout and keeps running; when
// the parent is killed the grandchild still holds the pipe, so 'close' on the
// parent cannot fire until the grandchild exits (LEAK_MS later).
const LEAK_MS = 10_000;
const leakyParentScript = `
const { spawn } = require('child_process');
spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${LEAK_MS})'], {
  stdio: ['ignore', process.stdout, 'ignore'],
});
setTimeout(() => {}, ${LEAK_MS});
`;

test('runScriptWithTimeout settles on timeout even when a grandchild holds the pipe', async () => {
  if (process.platform === 'win32') return; // POSIX process-tree semantics

  const result = await runScriptWithTimeout({
    command: process.execPath,
    args: ['-e', leakyParentScript],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 500,
  });

  expect(result.timedOut).toBe(true);
  expect(result.success).toBe(false);
  expect(result.error).toBe('Command timed out after 500ms');
  // Without the settle-on-timeout fix this await blocks until the grandchild
  // exits (10 s), past the test deadline.
  expect(result.durationMs).toBeLessThan(5000);
}, 8000);

test('runCommandCapture rejects on timeout without waiting for pipe close', async () => {
  if (process.platform === 'win32') return; // POSIX process-tree semantics

  await expect(
    runCommandCapture(
      process.execPath,
      ['-e', leakyParentScript],
      { timeoutMs: 500 },
    ),
  ).rejects.toThrow('Command timed out after 500ms');
}, 8000);
