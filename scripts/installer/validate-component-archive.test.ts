import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const projectRoot = path.resolve(__dirname, '..', '..');
const validatorPath = path.join(__dirname, 'validate-component-archive.ps1');
const sevenZipPath = path.join(
  projectRoot,
  'node_modules',
  '7zip-bin',
  'win',
  'x64',
  '7za.exe',
);
const temporaryDirectories: string[] = [];

function runValidator(archivePath: string, prefix: string, executable = sevenZipPath) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      validatorPath,
      '-ArchivePath',
      archivePath,
      '-SevenZipPath',
      executable,
      '-Prefix',
      prefix,
    ],
    { encoding: 'utf8' },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== 'win32')('component archive validator', () => {
  test('accepts ordinary channel runtime paths emitted by 7-Zip', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-component-validator-'));
    temporaryDirectories.push(root);
    const componentRoot = path.join(root, 'channel-runtime');
    const archivePath = path.join(root, 'channel-runtime.7z');
    fs.mkdirSync(componentRoot);
    fs.writeFileSync(path.join(componentRoot, 'cc-connect-sidecar.exe'), 'runtime');
    fs.writeFileSync(path.join(componentRoot, 'runtime-build-info.json'), '{}');

    const archive = spawnSync(
      sevenZipPath,
      ['a', '-t7z', archivePath, 'channel-runtime'],
      { cwd: root, encoding: 'utf8' },
    );
    expect(archive.status, archive.stderr || archive.stdout).toBe(0);

    const accepted = runValidator(archivePath, 'channel-runtime');
    expect(accepted.status, accepted.stderr || accepted.stdout).toBe(0);
    expect(accepted.stdout).toContain('Component archive validation passed');

    const rejected = runValidator(archivePath, 'wrong-prefix');
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('Unexpected archive entry: channel-runtime');
  });

  test('rejects non-empty link metadata reported by 7-Zip', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-component-link-validator-'));
    temporaryDirectories.push(root);
    const archivePath = path.join(root, 'component.7z');
    const fakeSevenZipPath = path.join(root, 'fake-7za.cmd');
    fs.writeFileSync(archivePath, 'fixture');
    fs.writeFileSync(
      fakeSevenZipPath,
      [
        '@echo off',
        'echo Path = fixture.7z',
        'echo Path = channel-runtime',
        'echo Symbolic Link = ..\\outside',
        'exit /b 0',
      ].join('\r\n'),
    );

    const rejected = runValidator(archivePath, 'channel-runtime', fakeSevenZipPath);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('Archive contains link metadata');
  });
});
