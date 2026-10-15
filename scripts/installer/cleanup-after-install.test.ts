import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const scriptPath = path.join(__dirname, 'cleanup-after-install.ps1');
const temporaryDirectories: string[] = [];
const currentId = 'a'.repeat(64);
const backupId = 'b'.repeat(32);

function writeSentinel(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
  const sentinel = path.join(directory, 'keep.txt');
  fs.writeFileSync(sentinel, 'user-owned data');
  return sentinel;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-cleanup-'));
  temporaryDirectories.push(root);
  const installDir = path.join(root, 'ZhiYuan [private] & app');
  const runtimeRoot = path.join(root, 'runtimes');
  const manifestPath = path.join(root, 'manifest.json');
  const markerPath = path.join(root, 'old-install-path.txt');
  writeSentinel(installDir);
  fs.mkdirSync(path.join(runtimeRoot, 'portable-git', currentId), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      components: [
        'channel-runtime',
        'skills',
        'mcps',
        'portable-git',
        'python',
        'skill-python',
        'uv',
      ].map(key => ({ key, contentId: currentId })),
    }),
  );
  return { root, installDir, runtimeRoot, manifestPath, markerPath };
}

function runCleanup(
  data: ReturnType<typeof fixture>,
  options: { backup?: string; legacy?: boolean } = {},
) {
  const args = [
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
    '-ManifestPath',
    data.manifestPath,
    '-OldInstallPathFile',
    data.markerPath,
  ];
  if (!options.legacy) args.push('-UseExactOldInstallPath');
  if (options.backup) args.push('-OldInstallPath', options.backup);
  return spawnSync('powershell.exe', args, { encoding: 'utf8' });
}

async function expectRemoved(directory: string) {
  const deadline = Date.now() + 15_000;
  while (fs.existsSync(directory) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  expect(fs.existsSync(directory), `backup was not reclaimed: ${directory}`).toBe(false);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('post-install cleanup ownership contract', () => {
  test('never discovers transaction backups through a wildcard or recursive delete', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source).toContain('[switch]$UseExactOldInstallPath');
    expect(source).toContain("$PSBoundParameters.ContainsKey('OldInstallPath')");
    expect(source).toContain('[regex]::Escape($installFull)');
    expect(source).not.toMatch(/Get-ChildItem[^\r\n]*-Path /);
    expect(source).not.toMatch(/Remove-Item[^\r\n]*-Recurse/);
    expect(source.indexOf('ReparsePoint', source.indexOf('$deleteTree ='))).toBeLessThan(
      source.indexOf('Get-ChildItem', source.indexOf('$deleteTree =')),
    );
  });

  test('limits component reclamation to the current contract and owned completion records', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source).toContain('$rows.Count -ne 7');
    expect(source).toContain("($completion -split '\\|', 2)[0] -cne $version.Name");
    expect(source).not.toContain("'runtime-packs'");
  });

  test('normalizes marker identity before asynchronous deletion and checks it is unchanged', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source).toContain('$backup = Get-NormalizedDirectoryPath $OldInstallPath');
    expect(source).toContain('$markerBackup = Get-NormalizedDirectoryPath $markerContent.Trim()');
    expect(source).toContain(
      '[string]::Equals($markerBackup, $backup, [StringComparison]::OrdinalIgnoreCase)',
    );
    expect(source.indexOf('$markerBackup =')).toBeLessThan(source.indexOf('Start-Process'));
    expect(source).toContain(
      '(Get-Content -LiteralPath $OldInstallPathFile -Raw) -ceq $ownedMarker',
    );
  });
});

describe.skipIf(process.platform !== 'win32')('post-install cleanup on Windows', () => {
  test('removes only the exact transaction backup with literal bracketed paths', async () => {
    const data = fixture();
    const backup = `${data.installDir}.old.${backupId}`;
    writeSentinel(backup);
    const preserved = [
      data.installDir,
      `${data.installDir}.old-notes`,
      `${data.installDir}.old.manual-acceptance`,
      `${data.installDir}.old.${'c'.repeat(32)}`,
      `${data.installDir}.old.12345`,
      data.installDir.replace('[private]', 'p') + `.old.${backupId}`,
    ].map(writeSentinel);
    fs.writeFileSync(data.markerPath, backup);

    const result = runCleanup(data, { backup });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    await expectRemoved(backup);
    for (const sentinel of preserved) {
      expect(fs.readFileSync(sentinel, 'utf8')).toBe('user-owned data');
    }
    expect(fs.existsSync(data.markerPath)).toBe(false);
  });

  test('uses only the recorded NSIS tick path when no explicit mode is supplied', async () => {
    const data = fixture();
    const backup = `${data.installDir}.old.-12345`;
    writeSentinel(backup);
    const preserved = writeSentinel(`${data.installDir}.old.12345`);
    fs.writeFileSync(data.markerPath, backup);
    const result = runCleanup(data, { legacy: true });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    await expectRemoved(backup);
    expect(fs.readFileSync(preserved, 'utf8')).toBe('user-owned data');
    expect(fs.existsSync(data.markerPath)).toBe(false);
  });

  test('reads NSIS UTF-16 BOM markers without losing Chinese installation paths', async () => {
    const data = fixture();
    data.installDir = path.join(data.root, '安装路径 [保留] & app');
    writeSentinel(data.installDir);
    const backup = `${data.installDir}.old.123456`;
    writeSentinel(backup);
    const preserved = writeSentinel(`${data.installDir}.old.manual`);
    fs.writeFileSync(data.markerPath, '\ufeff' + backup, 'utf16le');
    const result = runCleanup(data, { legacy: true });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    await expectRemoved(backup);
    expect(fs.readFileSync(preserved, 'utf8')).toBe('user-owned data');
    expect(fs.existsSync(data.markerPath)).toBe(false);
  });

  test('recognizes normalized marker spellings as the same exact backup', async () => {
    const data = fixture();
    const backup = `${data.installDir}.old.${backupId}`;
    writeSentinel(backup);
    // Alternate separators and a trailing separator must normalize on both
    // sides, just like the runner's short-name and expanded temp paths.
    fs.writeFileSync(data.markerPath, backup.replaceAll('\\', '/') + '/');
    const result = runCleanup(data, { backup });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    await expectRemoved(backup);
    expect(fs.existsSync(data.markerPath)).toBe(false);
  });

  test('preserves a marker naming a different valid transaction backup', async () => {
    const data = fixture();
    const backup = `${data.installDir}.old.${backupId}`;
    const otherBackup = `${data.installDir}.old.${'c'.repeat(32)}`;
    writeSentinel(backup);
    const preserved = writeSentinel(otherBackup);
    fs.writeFileSync(data.markerPath, otherBackup);
    const result = runCleanup(data, { backup });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    await expectRemoved(backup);
    expect(fs.readFileSync(preserved, 'utf8')).toBe('user-owned data');
    expect(fs.readFileSync(data.markerPath, 'utf8')).toBe(otherBackup);
  });

  test('does not consume a stale marker during a fresh shell install', () => {
    const data = fixture();
    const backup = `${data.installDir}.old.${backupId}`;
    const preserved = writeSentinel(backup);
    fs.writeFileSync(data.markerPath, backup);
    const result = runCleanup(data);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.readFileSync(preserved, 'utf8')).toBe('user-owned data');
    expect(fs.readFileSync(data.markerPath, 'utf8')).toBe(backup);
  });

  test('unlinks nested junctions without touching the external target', async () => {
    const data = fixture();
    const backup = `${data.installDir}.old.${backupId}`;
    writeSentinel(path.join(backup, 'resources', 'nested'));
    const userData = path.join(data.root, 'user-data');
    const preserved = writeSentinel(userData);
    fs.symlinkSync(userData, path.join(backup, 'resources', 'nested', 'user-link'), 'junction');
    const result = runCleanup(data, { backup });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    await expectRemoved(backup);
    expect(fs.readFileSync(preserved, 'utf8')).toBe('user-owned data');
  });

  test('rejects a backup junction before deleting its marker or user files', () => {
    const data = fixture();
    const backup = `${data.installDir}.old.${backupId}`;
    const userData = path.join(data.root, 'user-data');
    const preserved = writeSentinel(userData);
    fs.symlinkSync(userData, backup, 'junction');
    fs.writeFileSync(data.markerPath, backup);
    const result = runCleanup(data, { backup });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unsafe cleanup directory link');
    expect(fs.readFileSync(preserved, 'utf8')).toBe('user-owned data');
    expect(fs.readFileSync(data.markerPath, 'utf8')).toBe(backup);
    expect(fs.lstatSync(backup).isSymbolicLink()).toBe(true);
  });

  test.each(['old-notes', 'old.manual', 'old.12345/child', 'other.old.12345'])(
    'rejects an unowned exact path: %s',
    suffix => {
      const data = fixture();
      const backup = `${data.installDir}.${suffix}`;
      const preserved = writeSentinel(backup);
      fs.writeFileSync(data.markerPath, backup);
      const result = runCleanup(data, { backup });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Unowned previous installation');
      expect(fs.readFileSync(preserved, 'utf8')).toBe('user-owned data');
      expect(fs.readFileSync(data.markerPath, 'utf8')).toBe(backup);
    },
  );

  test('retains retired runtime data and unowned component folders', () => {
    const data = fixture();
    const component = path.join(data.runtimeRoot, 'portable-git');
    const oldId = 'b'.repeat(64);
    const oldVersion = path.join(component, oldId);
    writeSentinel(oldVersion);
    fs.writeFileSync(path.join(oldVersion, '.complete'), `${oldId}|archive|1|10`);
    const preserved = [
      path.join(data.root, 'runtime-packs', 'retired-model'),
      path.join(data.runtimeRoot, 'retired-runtime'),
      path.join(component, 'notes'),
      path.join(component, 'c'.repeat(64)),
      path.join(component, currentId),
    ].map(writeSentinel);
    const result = runCleanup(data);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.existsSync(oldVersion)).toBe(false);
    for (const sentinel of preserved) {
      expect(fs.readFileSync(sentinel, 'utf8')).toBe('user-owned data');
    }
  });

  test('rejects retired manifest keys before scheduling backup deletion', () => {
    const data = fixture();
    const backup = `${data.installDir}.old.${backupId}`;
    const preserved = writeSentinel(backup);
    fs.writeFileSync(
      data.manifestPath,
      JSON.stringify({ components: [{ key: 'retired-runtime', contentId: currentId }] }),
    );
    const result = runCleanup(data, { backup });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid cleanup manifest');
    expect(fs.readFileSync(preserved, 'utf8')).toBe('user-owned data');
  });
});
