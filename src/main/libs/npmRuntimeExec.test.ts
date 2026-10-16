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
 * Resolves with a complete pid, and keeps watching if the directory event
 * arrives before the write is finished. A partial read used to become another
 * live process under a parallel run.
 */
const waitForPidFile = (file: string): Promise<number> =>
  new Promise((resolve, reject) => {
    let watcher: fs.FSWatcher | undefined;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      watcher?.close();
      reject(new Error(`timed out waiting for ${file}`));
    }, 5000);
    const finish = (pid: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watcher?.close();
      resolve(pid);
    };
    const read = (): void => {
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8').trim();
      } catch {
        return;
      }
      if (/^[1-9]\d*$/.test(text)) finish(Number(text));
    };
    watcher = fs.watch(path.dirname(file), read);
    watcher.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watcher?.close();
      reject(error);
    });
    read();
  });

/**
 * Start time of a live process, or null once it is a zombie or gone.
 * Comparing this before and after the kill distinguishes "still running"
 * from "pid reused by an unrelated process".
 */
const liveProcessMark = (pid: number): string | null => {
  if (process.platform === 'win32') {
    try {
      process.kill(pid, 0);
      return 'alive';
    } catch {
      return null;
    }
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(') ') + 2);
    if (rest.startsWith('Z')) return null;
    const startTime = rest.split(' ')[19];
    return startTime ? `start:${startTime}` : 'alive';
  } catch {
    return null;
  }
};

/** Waits until the process captured before the kill is no longer that process. */
const waitUntilProcessGone = async (pid: number, mark: string): Promise<void> => {
  const deadline = Date.now() + 2000;
  while (liveProcessMark(pid) === mark) {
    if (Date.now() > deadline) {
      throw new Error(`process ${pid} was still alive after cancellation`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

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
  const mark = liveProcessMark(pid);
  expect(mark).not.toBeNull();
  controller.abort();

  await expect(pending).rejects.toBeInstanceOf(NpmCommandAbortedError);
  // A stop must not leave npm running in the background.
  await waitUntilProcessGone(pid, mark!);
});

test('runNpmCommand kills what the child spawned, not just the child', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-exec-tree-'));
  const selfPidFile = path.join(dir, 'self.pid');
  const childPidFile = path.join(dir, 'child.pid');
  // Mirrors `npm run build`: npm spawns the script, the script spawns the compiler.
  // The grandchild writes its own pid, so the file exists only after that process is running.
  const grandchildSource = `
    const fs = require('fs');
    fs.writeFileSync(process.argv[1], String(process.pid));
    setTimeout(() => {}, 20000);
  `;
  const script = `
    const fs = require('fs');
    const { spawn } = require('child_process');
    const [selfFile, childFile] = process.argv.slice(1);
    fs.writeFileSync(selfFile, String(process.pid));
    spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}, childFile], {
      stdio: 'ignore',
    });
    setTimeout(() => {}, 20000);
  `;
  const controller = new AbortController();
  const pending = runNpmCommand(process.execPath, ['-e', script, selfPidFile, childPidFile], {
    cwd: dir,
    signal: controller.signal,
  });

  const selfPid = await waitForPidFile(selfPidFile);
  const grandchildPid = await waitForPidFile(childPidFile);
  const selfMark = liveProcessMark(selfPid);
  const grandchildMark = liveProcessMark(grandchildPid);
  expect(selfMark).not.toBeNull();
  expect(grandchildMark).not.toBeNull();
  controller.abort();

  await expect(pending).rejects.toBeInstanceOf(NpmCommandAbortedError);
  // The rejection means the work is gone, not merely that npm stopped waiting.
  // Poll the same start-time mark: a one-shot check races pid reuse when the
  // full suite is spawning processes in parallel.
  await waitUntilProcessGone(selfPid, selfMark!);
  await waitUntilProcessGone(grandchildPid, grandchildMark!);
});
