import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { CONTROL_FILE, stopStandaloneBridge } from '../server/standaloneControl.cjs';

const fixture = fileURLToPath(new URL('./bridge-process.cjs', import.meta.url));
const source = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);

async function withBridge(
  ipc: boolean,
  check: (fixture: {
    marker: string;
    root: string;
    port: number;
    child: ReturnType<typeof spawn>;
    exit: Promise<unknown[]>;
    output: string[];
    stopCli: () => Promise<{ stdout: string }>;
  }) => Promise<void>,
  prepare?: (root: string) => string[],
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-lifecycle-'));
  for (const file of [
    'scripts/start-server.mjs',
    'scripts/stop-server.mjs',
    'server/standaloneControl.cjs',
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(source, file), path.join(root, file));
  }
  const child = spawn(process.execPath, [fixture, root, ...(prepare?.(root) ?? [])], {
    stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 8000);
  let stderr = '';
  child.stderr?.on('data', chunk => {
    stderr += chunk.toString();
  });
  const stdout = readline.createInterface({ input: child.stdout! });
  const output: string[] = [];
  const ready = new Promise<number>(resolve => {
    stdout.on('line', line => {
      output.push(line);
      if (line.startsWith('ready:')) resolve(Number(line.slice('ready:'.length)));
    });
  });
  try {
    const port = await Promise.race([
      ready,
      exit.then(() => {
        throw new Error(stderr);
      }),
    ]);
    await check({
      marker: path.join(root, CONTROL_FILE),
      root,
      port,
      child,
      exit,
      output,
      stopCli: () =>
        run(process.execPath, [path.join(root, 'scripts', 'stop-server.mjs')], { timeout: 4000 }),
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exit;
    clearTimeout(timeout);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function health(port: number) {
  return (
    await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) })
  ).json();
}

test('standalone stop ignores a legacy PID for a desktop bridge and only IPC disconnect stops it', async () => {
  await withBridge(true, async ({ marker, root, port, child, exit, stopCli }) => {
    expect(fs.existsSync(marker)).toBe(false);
    fs.writeFileSync(path.join(root, '.server.pid'), String(child.pid));
    expect((await stopCli()).stdout).toContain('No standalone Bridge Server was stopped');
    expect(await health(port)).toMatchObject({ success: true, data: { status: 'healthy' } });
    child.disconnect();
    expect(await exit).toEqual([0, null]);
  });
}, 10000);

test('standalone Bridge Server validates its instance secret and acknowledges shutdown', async () => {
  await withBridge(false, async ({ marker, root, port, exit, stopCli }) => {
    const state = fs.readFileSync(marker, 'utf8');
    const copied = fs.mkdtempSync(path.join(root, 'copied-'));
    fs.writeFileSync(path.join(copied, CONTROL_FILE), state);
    expect(await stopStandaloneBridge(copied)).toBe(false);
    fs.writeFileSync(marker, JSON.stringify({ ...JSON.parse(state), secret: '0'.repeat(64) }));
    expect(await stopStandaloneBridge(root)).toBe(false);
    expect(await health(port)).toMatchObject({ success: true });
    fs.writeFileSync(marker, state);
    expect((await stopCli()).stdout).toContain('Bridge Server stopped successfully');
    expect(await exit).toEqual([0, null]);
    expect(fs.existsSync(marker)).toBe(false);
  });
}, 10000);

test('forced repair refuses a port owned by another process', async () => {
  await withBridge(true, async ({ root, port, child }) => {
    fs.writeFileSync(path.join(root, '.server.pid'), String(child.pid));
    fs.appendFileSync(
      path.join(root, 'server', 'standaloneControl.cjs'),
      `\nmodule.exports.DEFAULT_SERVER_URL = 'http://127.0.0.1:${port}';\n`,
    );
    await expect(
      run(process.execPath, [path.join(root, 'scripts', 'start-server.mjs')], {
        env: { ...process.env, WEB_SEARCH_FORCE_REPAIR: '1' },
        timeout: 4000,
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`port ${port} is occupied`),
    });
    expect(await health(port)).toMatchObject({ success: true });
  });
}, 10000);

test.skipIf(process.platform === 'win32')(
  'disconnect cancels an owned Chrome launch and prevents a second launch',
  async () => {
    await withBridge(
        true,
        async ({ root, child, exit, port, output }) => {
          const chromeLog = path.join(root, 'chrome.log');
          const launch = () =>
            fetch(`http://127.0.0.1:${port}/api/browser/launch`, { method: 'POST' }).catch(
              () => null,
            );
          const first = launch();
          await expect.poll(() => fs.existsSync(chromeLog), { timeout: 3000 }).toBe(true);
          const second = launch();
          await expect
            .poll(() => output.filter(line => line === '[API] POST /api/browser/launch'))
            .toHaveLength(2);
          child.disconnect();
          expect(await exit).toEqual([0, null]);
          await Promise.all([first, second]);
          expect(fs.readFileSync(chromeLog, 'utf8')).toBe('started\nstopped\n');
          expect(fs.readdirSync(root).filter(name => name.startsWith('zhiyuan-web-search-'))).toEqual([]);
        },
        root => {
          const chrome = path.join(root, 'fixture-chrome');
          fs.writeFileSync(
            chrome,
            `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst log = ${JSON.stringify(path.join(root, 'chrome.log'))};\nprocess.on('SIGTERM', () => { fs.appendFileSync(log, 'stopped\\n'); process.exit(0); });\nfs.appendFileSync(log, 'started\\n');\nsetInterval(() => {}, 1000);\nsetTimeout(() => process.exit(1), 7000).unref();\n`,
            { mode: 0o700 },
          );
          return [chrome];
        },
    );
  },
  10000,
);
