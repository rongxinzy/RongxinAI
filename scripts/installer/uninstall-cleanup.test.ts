import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const scriptPath = path.join(__dirname, 'uninstall-cleanup.ps1');
const temporaryDirectories: string[] = [];
const currentId = 'a'.repeat(64);
const staleId = 'b'.repeat(64);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-uninstall-'));
  temporaryDirectories.push(root);
  const installDir = path.join(root, 'ZhiYuan [private] app');
  const runtimeRoot = path.join(root, 'runtimes');
  const resources = path.join(installDir, 'resources');
  fs.mkdirSync(resources, { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, 'skill-python', currentId), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, 'uv', currentId), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, 'uv', currentId, '.complete'), `${currentId}|archive|1|10`);
  fs.writeFileSync(
    path.join(runtimeRoot, 'uv', currentId, 'keep.txt'),
    'component payload',
  );
  return { root, installDir, runtimeRoot, resources };
}

function runCleanup(data: ReturnType<typeof fixture>) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-InstallDir',
      data.installDir,
      '-RuntimeRoot',
      data.runtimeRoot,
    ],
    { encoding: 'utf8' },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== 'win32')('uninstall component cleanup', () => {
  test('reclaims a version whose files sit past MAX_PATH', () => {
    const data = fixture();
    const version = path.join(data.runtimeRoot, 'skill-python', staleId);
    const deep = path.join(
      version,
      ...Array.from({ length: 5 }, () => 'segment'.padEnd(40, 'x')),
    );
    fs.mkdirSync(deep, { recursive: true });
    const deepFile = path.join(deep, 'deep-artifact.dll');
    expect(deepFile.length).toBeGreaterThan(260);
    fs.writeFileSync(deepFile, 'deep');
    fs.writeFileSync(path.join(version, '.complete'), `${staleId}|archive|1|10`);

    const result = runCleanup(data);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.existsSync(version)).toBe(false);
  });

  test('removes the completion marker before the payload so a partial delete is not reused', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    const markerIndex = source.indexOf('[IO.File]::Delete((ConvertTo-LongPath $complete))');
    const deleteIndex = source.indexOf('Remove-TreeWithoutFollowingLinks $version.FullName');
    expect(markerIndex).toBeGreaterThan(-1);
    expect(markerIndex).toBeLessThan(deleteIndex);
  });

  test('removes the component junction before electron-builder deletes the install root', () => {
    const data = fixture();
    const target = path.join(data.runtimeRoot, 'skill-python', currentId);
    const link = path.join(data.resources, 'skill-python');
    fs.symlinkSync(target, link, 'junction');

    const result = runCleanup(data);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
  });
});
