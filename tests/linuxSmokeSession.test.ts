import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { test, expect } from 'vitest';
import {
  readBrowserEndpoint,
  stopProcessGroup,
  verifyBrowserProcess,
} from '../scripts/ci/linux-smoke-session.mjs';

const linuxTest = test.skipIf(process.platform !== 'linux');

test('smoke accepts only this launch output with a unique loopback browser endpoint', () => {
  const endpoint = 'ws://127.0.0.1:43123/devtools/browser/session-123';
  expect(readBrowserEndpoint(`DevTools listening on ${endpoint}\n`)).toBe(endpoint);
  assert.equal(readBrowserEndpoint('old endpoint available at port 9222'), null);
  assert.equal(readBrowserEndpoint(`DevTools listening on ${endpoint}`), null);
  assert.throws(() => readBrowserEndpoint('DevTools listening on ws://example.com:1/a\n'));
  assert.throws(() =>
    readBrowserEndpoint(`DevTools listening on ${endpoint}\nDevTools listening on ${endpoint}x\n`),
  );
});

linuxTest('smoke verifies browser PID, group and launch nonce', async () => {
  const nonce = randomUUID();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ZHIYUAN_LINUX_SMOKE_NONCE: nonce },
  });
  await once(child, 'spawn');
  const pid = child.pid;
  assert.ok(pid);
  try {
    const processes = [{ type: 'browser', id: pid }];
    await verifyBrowserProcess(processes, pid, nonce);
    await assert.rejects(verifyBrowserProcess(processes, pid, 'stale-nonce'));
    await assert.rejects(verifyBrowserProcess(processes, pid + 1, nonce));
    await assert.rejects(verifyBrowserProcess([], pid, nonce));
    await assert.rejects(verifyBrowserProcess([...processes, ...processes], pid, nonce));
  } finally {
    await stopProcessGroup(pid);
  }
});

linuxTest('smoke kills live children after their wrapper exits', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smoke-cleanup-test-'));
  const pidFile = path.join(directory, 'child.pid');
  const script = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],",
    "  { stdio: 'ignore' });",
    "require('node:fs').writeFileSync(process.argv[1], String(child.pid));",
    'child.unref();',
  ].join('\n');
  const wrapper = spawn(process.execPath, ['-e', script, pidFile], {
    detached: true,
    stdio: 'ignore',
  });
  try {
    await once(wrapper, 'exit');
    assert.equal(wrapper.exitCode, 0);
    const childPid = Number(await fs.readFile(pidFile, 'utf8'));
    process.kill(childPid, 0);
    await stopProcessGroup(wrapper.pid);
    try {
      const stat = await fs.readFile(`/proc/${childPid}/stat`, 'utf8');
      assert.match(stat.slice(stat.lastIndexOf(')') + 2), /^[ZX] /);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  } finally {
    await stopProcessGroup(wrapper.pid);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('renderer binds the browser identity before requesting a rendered page', async () => {
  const source = await fs.readFile('scripts/verify-linux-renderer.mjs', 'utf8');
  assert.ok(source.includes("'--remote-debugging-port=0'"));
  assert.ok(source.includes('ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA: profilePath'));
  assert.ok(source.includes('ZHIYUAN_LINUX_SMOKE_NONCE: nonce'));
  assert.ok(source.includes("browserDevTools.send('SystemInfo.getProcessInfo')"));
  assert.ok(
    source.indexOf('await verifyBrowserProcess(') <
      source.indexOf('await waitForPageTarget(browserEndpoint)'),
  );
  assert.ok(source.includes('await stopProcessGroup(application.pid)'));
  assert.ok(source.includes('const cleanup = installSmokeCleanup('));
  assert.ok(
    source.indexOf('const cleanup = installSmokeCleanup(') <
      source.indexOf('const application = spawn('),
  );
  assert.ok(source.includes('await cleanup();'));
});

linuxTest('interrupted renderer cleans its detached group and profile before failing', async () => {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smoke-signal-test-'));
    const pidFile = path.join(directory, 'pid');
    const profileFile = path.join(directory, 'profile');
    await fs.writeFile(
      path.join(directory, 'xvfb-run'),
      '#!/bin/sh\necho $$ > "$SMOKE_PID_FILE"\n' +
        'echo "$ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA" > "$SMOKE_PROFILE_FILE"\nexec sleep 60\n',
      { mode: 0o755 },
    );
    const child = spawn(process.execPath, ['scripts/verify-linux-renderer.mjs', '/bin/true'], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        SMOKE_PID_FILE: pidFile,
        SMOKE_PROFILE_FILE: profileFile,
      },
      stdio: 'ignore',
    });
    let group;
    try {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        try {
          group = Number(await fs.readFile(pidFile, 'utf8'));
          await fs.access(profileFile);
          break;
        } catch {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      assert.ok(group);
      const profile = (await fs.readFile(profileFile, 'utf8')).trim();
      await fs.access(profile);
      process.kill(group, 0);
      const exited = once(child, 'exit');
      child.kill(signal);
      const [code, terminatingSignal] = await exited;
      assert.equal(code, signal === 'SIGTERM' ? 143 : 130);
      assert.equal(terminatingSignal, null);
      await assert.rejects(fs.access(profile));
      assert.throws(() => process.kill(group, 0));
    } finally {
      child.kill('SIGKILL');
      await stopProcessGroup(group);
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
});

linuxTest('normal and interrupted completion share one cleanup promise', async () => {
  const helper = pathToFileURL(path.resolve('scripts/ci/linux-smoke-session.mjs')).href;
  const script = [
    `import { installSmokeCleanup } from ${JSON.stringify(helper)};`,
    'let calls = 0;',
    'const cleanup = installSmokeCleanup(async () => {',
    '  calls += 1;',
    '  await new Promise(resolve => setTimeout(resolve, 100));',
    "  console.log('cleanup calls: ' + calls);",
    '});',
    'void cleanup();',
    "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10);",
    'await cleanup();',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script]);
  let output = '';
  child.stdout.on('data', chunk => {
    output += chunk;
  });
  const [code] = await once(child, 'exit');
  assert.equal(code, 143);
  assert.equal(output.trim(), 'cleanup calls: 1');
});
