import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { ELECTRON_UPDATER_METADATA_FILENAMES } from './inference-edition-targets.mjs';

const VERSION = '2026.10.19-build.11';
const WINDOWS_TARGETS = ['win32:x64:lite', 'win32:x64:cpu', 'win32:x64:cuda'];
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function verify(targets: string[], platforms: string, corruptHash = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'updater-generation-'));
  directories.push(directory);
  const sha512 = Buffer.alloc(64, 1).toString('base64');
  const artifacts = targets.map(target => {
    const [platform, arch, variant] = target.split(':');
    return { platform, arch, variant, kind: 'updater', filename: 'setup.exe', sha512 };
  });
  const specs = targets.map((target, index) => {
    const artifact = artifacts[index];
    const filename = ELECTRON_UPDATER_METADATA_FILENAMES.get(target)!;
    const metadataPath = path.join(directory, target.replaceAll(':', '-'), filename);
    const url = `https://updates.rongxzyai.com/v2/electron/releases/${VERSION}/${artifact.platform}/${artifact.arch}/${artifact.variant}/setup.exe`;
    const hash = corruptHash ? Buffer.alloc(64, 2).toString('base64') : sha512;
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    // JSON is a YAML subset and exercises the production CLI parser.
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({ version: VERSION, files: [{ url, sha512: hash }], path: url, sha512: hash }),
    );
    return `${metadataPath}:${target}`;
  });
  const artifactPath = path.join(directory, 'artifacts.json');
  fs.writeFileSync(artifactPath, JSON.stringify({ schemaVersion: 1, releaseVersion: VERSION, artifacts }));
  return spawnSync(
    process.execPath,
    [
      path.resolve('scripts/release/verify-electron-updater-generation.mjs'),
      VERSION,
      ...specs,
      '--artifact-metadata',
      artifactPath,
    ],
    { encoding: 'utf8', env: { ...process.env, ZHIYUAN_RELEASE_PLATFORM: platforms } },
  );
}

test('accepts all three Windows editions for a Windows-only generation', () => {
  const result = verify(WINDOWS_TARGETS, 'win32');
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

test('still requires every selected Windows edition', () => {
  const result = verify(WINDOWS_TARGETS.slice(0, 2), 'win32');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('exactly the supported updater targets');
});

test('rejects metadata outside the selected platforms', () => {
  const result = verify([...WINDOWS_TARGETS, 'darwin:x64:cpu'], 'win32');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Unexpected electron-updater metadata target');
});

test('still requires all platforms when no filter is configured', () => {
  expect(verify(WINDOWS_TARGETS, '').status).not.toBe(0);
  expect(verify([...ELECTRON_UPDATER_METADATA_FILENAMES.keys()], '').status).toBe(0);
});

test('continues rejecting updater bytes that do not match uploaded metadata', () => {
  const result = verify(WINDOWS_TARGETS, 'win32', true);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('does not match an uploaded updater artifact');
});
