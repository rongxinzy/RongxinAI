import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import { NpmCommandAbortedError, NpmCommandError, runNpmCommand } from './npmRuntimeExec';

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

/**
 * Whether a killed process is really gone.
 *
 * On Windows a terminated process stops existing, so `process.kill(pid, 0)`
 * throws. On Linux the child we killed stays a zombie until its parent reaps it,
 * and `kill(pid, 0)` still succeeds, so the state has to come from /proc.
 */
const isDead = (pid: number): boolean => {
  if (process.platform === 'win32') {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(') ') + 2).startsWith('Z');
  } catch {
    return true;
  }
};

/** Resolves with the pid a child wrote, driven by the filesystem, not a sleep. */
const waitForPidFile = (file: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const read = (): boolean => {
      try {
        resolve(Number(fs.readFileSync(file, 'utf8')));
        return true;
      } catch {
        return false;
      }
    };
    if (read()) return;
    const watcher = fs.watch(path.dirname(file), () => {
      if (read()) watcher.close();
    });
    watcher.on('error', reject);
  });

test('runNpmCommand kills the child when the caller aborts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-exec-abort-'));
  const pidFile = path.join(dir, 'child.pid');
  const script = `
    const fs = require('fs');
    fs.writeFileSync(process.argv[1], String(process.pid));
    setTimeout(() => {}, 10000);
  `;
  const controller = new AbortController();
  const pending = runNpmCommand(process.execPath, ['-e', script, pidFile], {
    cwd: dir,
    signal: controller.signal,
  });

  const pid = await waitForPidFile(pidFile);
  controller.abort();

  await expect(pending).rejects.toBeInstanceOf(NpmCommandAbortedError);
  // A stop must not leave npm running in the background.
  expect(isDead(pid)).toBe(true);
});

test('runNpmCommand kills what the child spawned, not just the child', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-exec-tree-'));
  const selfPidFile = path.join(dir, 'self.pid');
  const childPidFile = path.join(dir, 'child.pid');
  // Mirrors `npm run build`: npm spawns the script, the script spawns the compiler.
  const script = `
    const fs = require('fs');
    const { spawn } = require('child_process');
    const [selfFile, childFile] = process.argv.slice(1);
    fs.writeFileSync(selfFile, String(process.pid));
    const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], {
      stdio: 'ignore',
    });
    fs.writeFileSync(childFile, String(grandchild.pid));
    setTimeout(() => {}, 20000);
  `;
  const controller = new AbortController();
  const pending = runNpmCommand(process.execPath, ['-e', script, selfPidFile, childPidFile], {
    cwd: dir,
    signal: controller.signal,
  });

  const selfPid = await waitForPidFile(selfPidFile);
  const grandchildPid = await waitForPidFile(childPidFile);
  controller.abort();

  await expect(pending).rejects.toBeInstanceOf(NpmCommandAbortedError);
  // The rejection means the work is gone, not merely that npm stopped waiting.
  expect(isDead(selfPid)).toBe(true);
  expect(isDead(grandchildPid)).toBe(true);
});
