import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import { NpmCommandError, runNpmCommand } from './npmRuntimeExec';

const runNode = (script: string, ...args: string[]): ReturnType<typeof runNpmCommand> =>
  runNpmCommand(process.execPath, ['-e', script, ...args], { cwd: os.tmpdir() });

/**
 * Waits for a file the parent writes after launching this child, so the parent
 * never has to sleep: the child exits as soon as the parent proves it got its
 * event loop back. The safety exit keeps a synchronous spawn from hanging the run.
 */
const WAIT_FOR_FLAG_SCRIPT = `
const fs = require('fs');
const flag = process.argv[1];
const deadline = Date.now() + 5000;
const tick = () => {
  if (fs.existsSync(flag)) process.exit(0);
  if (Date.now() > deadline) process.exit(9);
  setTimeout(tick, 25);
};
tick();
`;

test('runNpmCommand captures the output of a successful command', async () => {
  const result = await runNode('process.stdout.write("hello-out")');

  expect(result.stdout).toContain('hello-out');
});

test('runNpmCommand hands the event loop back while the child is still running', async () => {
  const flagFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'npm-exec-')), 'flag');
  const pending = runNode(WAIT_FOR_FLAG_SCRIPT, flagFile);

  // Reached only if the call returned without waiting for the child to finish,
  // which is what stops a slow npm step from freezing the window.
  fs.writeFileSync(flagFile, 'go');
  const result = await pending;

  expect(result.stdout).toBe('');
});

test('runNpmCommand carries the failure output back to the caller', async () => {
  const error = await runNode(
    'console.error("npm ERR! missing script: build"); process.exit(7)',
  ).catch((reason: unknown) => reason);

  expect(error).toBeInstanceOf(NpmCommandError);
  expect((error as NpmCommandError).stderr).toContain('missing script: build');
  // The reason travels in the message: the caller only logs the error.
  expect((error as Error).message).toContain('missing script: build');
});
