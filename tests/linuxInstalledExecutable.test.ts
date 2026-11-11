import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { test } from 'vitest';
import { queryInstalledExecutable } from '../scripts/ci/linux-installed-executable.mjs';

function queryOutput(output: string) {
  return () =>
    spawn(process.execPath, ['-e', output], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
}

test('installed executable query streams a multi-megabyte package file list', async () => {
  const output = [
    "process.stdout.write('/opt/product/resources/python/file.py\\n'.repeat(100000));",
    "process.stdout.write('/opt/product/知远\\n');",
  ].join('\n');
  assert.throws(() => execFileSync(process.execPath, ['-e', output]), /ENOBUFS/);
  assert.equal(
    await queryInstalledExecutable('zhiyuan-agent', '知远', queryOutput(output)),
    '/opt/product/知远',
  );
});

test('installed executable query rejects missing, ambiguous and failed package listings', async () => {
  await assert.rejects(queryInstalledExecutable('pkg', 'app', queryOutput('')));
  await assert.rejects(
    queryInstalledExecutable(
      'pkg',
      'app',
      queryOutput("process.stdout.write('/opt/a/app\\n/opt/b/app\\n')"),
    ),
    /ambiguous/,
  );
  await assert.rejects(
    queryInstalledExecutable(
      'pkg',
      'app',
      queryOutput("process.stdout.write('/opt/a/app\\n'); process.exitCode = 7"),
    ),
    /file listing failed/,
  );
});

test('installed executable query bounds timeout cleanup and rejects spawn errors', async () => {
  let child: ReturnType<typeof spawn> | undefined;
  const launch = () => {
    child = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    return child;
  };
  await assert.rejects(
    queryInstalledExecutable('pkg', 'app', launch, { timeoutMs: 2_000, killGraceMs: 50 }),
    /timed out/,
  );
  assert.equal(child?.signalCode, 'SIGKILL');
  await assert.rejects(
    queryInstalledExecutable('pkg', 'app', () =>
      spawn('/missing-linux-dpkg-query-command', [], { stdio: ['ignore', 'pipe', 'inherit'] }),
    ),
    /ENOENT/,
  );
});
