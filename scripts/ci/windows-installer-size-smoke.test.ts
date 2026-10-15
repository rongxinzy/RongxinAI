import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const temporaryDirectories: string[] = [];
const scriptPath = path.join(__dirname, 'windows-installer-size-smoke.ps1');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-installer-size-test-'));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.mkdirSync(path.join(root, 'build-tar', 'windows-components'), { recursive: true });
  fs.writeFileSync(path.join(root, 'release', 'ZhiYuan-Setup.exe'), Buffer.alloc(100));
  fs.writeFileSync(
    path.join(root, 'build-tar', 'windows-components', 'manifest.json'),
    JSON.stringify({
      components: [
        {
          key: 'portable-git',
          archiveSizeBytes: 40,
          archiveCompression: 'lzma-bcj2-d128m-mx9-solid-v1',
        },
      ],
    }),
  );
  return root;
}

function runSizeCheck(
  projectRoot: string,
  maximumInstallerBytes: number,
  maximumComponentBytes: number,
  maximumNonComponentBytes: number,
) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-ProjectRoot',
      projectRoot,
      '-MaximumInstallerBytes',
      String(maximumInstallerBytes),
      '-MaximumComponentBytes',
      String(maximumComponentBytes),
      '-MaximumNonComponentBytes',
      String(maximumNonComponentBytes),
    ],
    { encoding: 'utf8' },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== 'win32')('Windows installer size smoke check', () => {
  test('reports component compression and accepts a package within every budget', () => {
    const result = runSizeCheck(createFixture(), 100, 40, 60);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('lzma-bcj2-d128m-mx9-solid-v1');
    expect(result.stdout).toContain('non-component bytes: 60');
  });

  test('checks the NSIS budget separately when a final WebView2 installer is also present', () => {
    const root = createFixture();
    fs.writeFileSync(path.join(root, 'release', 'ZhiYuanAgent-Setup-1.0.0.exe'), Buffer.alloc(120));
    const result = runSizeCheck(root, 100, 40, 60);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ZhiYuan-Setup.exe');
  });

  test.each([
    ['component', 100, 39, 60, 'component archives are unexpectedly large'],
    ['non-component', 100, 40, 59, 'non-component payload is unexpectedly large'],
    ['installer', 99, 40, 60, 'installer is unexpectedly large'],
  ])('rejects an oversized %s payload', (_, installer, component, nonComponent, message) => {
    const result = runSizeCheck(createFixture(), installer, component, nonComponent);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  });
});

test('installer budgets distinguish required WebView2 overhead without widening NSIS or components', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  for (const contract of [
    '$MaximumInstallerBytes = 450MB',
    '$MaximumNonComponentBytes = 150MB',
    '$MaximumComponentBytes = 300MB',
    '$MaximumShellBytes = 500MB',
    '$MaximumShellNonComponentBytes = 220MB',
    '$shellBytes -gt $MaximumShellBytes',
    '$shellNonComponentBytes -gt $MaximumShellNonComponentBytes',
  ])
    expect(source).toContain(contract);
});

test.skipIf(process.platform !== 'win32')(
  'real size gate accepts separate kinds and rejects either total or non-component overflow',
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-budget-'));
    try {
      fs.mkdirSync(path.join(root, 'release'));
      fs.mkdirSync(path.join(root, 'build-tar/windows-components'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'build-tar/windows-components/manifest.json'),
        JSON.stringify({
          components: [{ key: 'fixture', archiveSizeBytes: 100, archiveCompression: '7z' }],
        }),
      );
      const nsis = path.join(root, 'release/Fixture-Setup.exe');
      const shell = path.join(root, 'release/ZhiYuanAgent-Setup-fixture.exe');
      fs.writeFileSync(nsis, Buffer.alloc(200));
      fs.writeFileSync(shell, Buffer.alloc(300));
      const run = (shellNonComponentLimit = 220) =>
        spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            scriptPath,
            '-ProjectRoot',
            root,
            '-MaximumInstallerBytes',
            '250',
            '-MaximumNonComponentBytes',
            '150',
            '-MaximumComponentBytes',
            '120',
            '-MaximumShellBytes',
            '350',
            '-MaximumShellNonComponentBytes',
            String(shellNonComponentLimit),
          ],
          { encoding: 'utf8' },
        );
      expect(run().status).toBe(0);
      fs.writeFileSync(nsis, Buffer.alloc(251));
      expect(run().status).not.toBe(0);
      fs.writeFileSync(nsis, Buffer.alloc(200));
      fs.writeFileSync(shell, Buffer.alloc(321));
      expect(run().status).not.toBe(0);
      fs.writeFileSync(shell, Buffer.alloc(351));
      expect(run(500).status).not.toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
