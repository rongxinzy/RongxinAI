import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const projectRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(__dirname, 'validate-offline-components.ps1');
const targetsPath = path.join(projectRoot, 'scripts', 'nsis-offline-components.json');
const sevenZipPath = path.join(
  projectRoot,
  'node_modules',
  '7zip-bin',
  'win',
  'x64',
  '7za.exe',
);
const temporaryDirectories: string[] = [];

type ComponentTarget = { key: string; prefix: string; sentinel: string };

function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function runValidator(mode: 'cache' | 'expand', pluginDir: string, runtimeRoot: string) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Mode',
      mode,
      '-PluginDir',
      pluginDir,
      '-RuntimeRoot',
      runtimeRoot,
      '-ComponentTargetsPath',
      targetsPath,
      '-SevenZipPath',
      sevenZipPath,
    ],
    { encoding: 'utf8' },
  );
}

function componentId(key: string): string {
  return sha256Hex(Buffer.from(`content-id:${key}`));
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-offline-components-'));
  temporaryDirectories.push(root);
  const pluginDir = path.join(root, 'plugin');
  const runtimeRoot = path.join(root, 'runtimes');
  fs.mkdirSync(pluginDir);
  fs.mkdirSync(runtimeRoot);
  const targets = JSON.parse(
    fs.readFileSync(targetsPath, 'utf8'),
  ) as ComponentTarget[];

  for (const target of targets) {
    const id = componentId(target.key);
    const sentinelRelative = target.sentinel.replace(/\\/g, '/');
    const staging = path.join(root, 'staging', target.key);
    const sentinelPath = path.join(staging, sentinelRelative);
    fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
    const sentinelContent = Buffer.from(`sentinel:${target.key}`);
    fs.writeFileSync(sentinelPath, sentinelContent);
    const extraPath = path.join(staging, target.prefix, 'extra.txt');
    fs.mkdirSync(path.dirname(extraPath), { recursive: true });
    fs.writeFileSync(extraPath, `extra:${target.key}`);

    const archivePath = path.join(pluginDir, `component-${target.key}.7z`);
    const archived = spawnSync(
      sevenZipPath,
      ['a', '-t7z', archivePath, target.prefix],
      { cwd: staging, encoding: 'utf8' },
    );
    expect(archived.status, archived.stderr || archived.stdout).toBe(0);

    fs.writeFileSync(path.join(pluginDir, `component-${target.key}.version`), id);
    fs.writeFileSync(
      path.join(pluginDir, `component-${target.key}.sha256`),
      sha256Hex(fs.readFileSync(archivePath)),
    );
    fs.writeFileSync(
      path.join(pluginDir, `component-${target.key}.sentinel-sha256`),
      sha256Hex(sentinelContent),
    );
  }

  return { pluginDir, runtimeRoot, targets };
}

function expandFixture(fixture: ReturnType<typeof makeFixture>) {
  const expanded = runValidator('expand', fixture.pluginDir, fixture.runtimeRoot);
  expect(expanded.status, expanded.stderr || expanded.stdout).toBe(0);
  for (const target of fixture.targets) {
    expect(expanded.stdout).toContain(`expanded:${target.key}`);
  }
}

function targetDir(fixture: ReturnType<typeof makeFixture>, key: string): string {
  return path.join(fixture.runtimeRoot, key, componentId(key));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== 'win32')('offline component cache validator', () => {
  test('expand publishes a measured completion record that cache mode accepts', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    for (const target of fixture.targets) {
      const completePath = path.join(targetDir(fixture, target.key), '.complete');
      const record = fs.readFileSync(completePath, 'utf8').trim();
      const fields = record.split('|');
      expect(fields).toHaveLength(4);
      expect(fields[0]).toBe(componentId(target.key));
      expect(Number.parseInt(fields[2], 10)).toBeGreaterThan(0);
      expect(Number.parseInt(fields[3], 10)).toBeGreaterThan(0);
    }

    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot);
    expect(cached.status, cached.stderr || cached.stdout).toBe(0);
    for (const target of fixture.targets) {
      expect(cached.stdout).toContain(`cache-hit:${target.key}`);
      expect(
        fs.existsSync(path.join(fixture.pluginDir, `component-${target.key}.cache-valid`)),
      ).toBe(true);
    }
  });

  test('cache mode rejects a component tree left incomplete by an interrupted move', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    const victim = fixture.targets[1];
    const victimDir = targetDir(fixture, victim.key);
    fs.rmSync(path.join(victimDir, victim.prefix, 'extra.txt'));

    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot);
    expect(cached.status).toBe(0);
    expect(cached.stdout).not.toContain(`cache-hit:${victim.key}`);
    expect(cached.stdout).toContain(`cache-hit:${fixture.targets[0].key}`);
    expect(
      fs.existsSync(path.join(fixture.pluginDir, `component-${victim.key}.cache-valid`)),
    ).toBe(false);
  });

  test('cache mode rejects a completion record without measured entries', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    const victim = fixture.targets[2];
    const id = componentId(victim.key);
    fs.writeFileSync(
      path.join(targetDir(fixture, victim.key), '.complete'),
      `${id}|${sha256Hex(Buffer.from('legacy'))}`,
    );

    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot);
    expect(cached.status).toBe(0);
    expect(cached.stdout).not.toContain(`cache-hit:${victim.key}`);
    expect(cached.stdout).toContain(`cache-hit:${fixture.targets[3].key}`);
  });

  test('cache mode removes a stale installing directory next to a valid target', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    const key = fixture.targets[0].key;
    const stale = `${targetDir(fixture, key)}.installing`;
    fs.mkdirSync(path.join(stale, 'leftover'), { recursive: true });

    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot);
    expect(cached.status, cached.stderr || cached.stdout).toBe(0);
    expect(cached.stdout).toContain(`cache-hit:${key}`);
    expect(fs.existsSync(stale)).toBe(false);
  });

  test('expand re-extracts a component whose cached target was corrupted', () => {
    const fixture = makeFixture();
    expandFixture(fixture);

    // Mirror the installer flow: cache validation marks every component as
    // reusable before expand runs and skips the marked ones.
    const cached = runValidator('cache', fixture.pluginDir, fixture.runtimeRoot);
    expect(cached.status, cached.stderr || cached.stdout).toBe(0);

    const victim = fixture.targets[3];
    const root = temporaryDirectories[temporaryDirectories.length - 1];
    fs.rmSync(path.join(fixture.pluginDir, `component-${victim.key}.cache-valid`));
    fs.rmSync(targetDir(fixture, victim.key), { recursive: true, force: true });

    const staging = path.join(root, 'restaging');
    const sentinelPath = path.join(staging, victim.sentinel.replace(/\\/g, '/'));
    fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
    fs.writeFileSync(sentinelPath, `sentinel:${victim.key}`);
    const archivePath = path.join(fixture.pluginDir, `component-${victim.key}.7z`);
    const archived = spawnSync(
      sevenZipPath,
      ['a', '-t7z', archivePath, victim.prefix],
      { cwd: staging, encoding: 'utf8' },
    );
    expect(archived.status, archived.stderr || archived.stdout).toBe(0);
    fs.writeFileSync(
      path.join(fixture.pluginDir, `component-${victim.key}.sha256`),
      sha256Hex(fs.readFileSync(archivePath)),
    );

    const reexpanded = runValidator('expand', fixture.pluginDir, fixture.runtimeRoot);
    expect(reexpanded.status, reexpanded.stderr || reexpanded.stdout).toBe(0);
    expect(reexpanded.stdout).toContain(`expanded:${victim.key}`);
    expect(reexpanded.stdout).not.toContain(`expanded:${fixture.targets[4].key}`);
    expect(
      fs.existsSync(
        path.join(targetDir(fixture, victim.key), victim.sentinel.replace(/\\/g, '/')),
      ),
    ).toBe(true);
  });
});
