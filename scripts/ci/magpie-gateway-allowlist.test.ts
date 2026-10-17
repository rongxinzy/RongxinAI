import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { isPinnedMagpieGatewayBinary } from './magpie-gateway-allowlist.mjs';

const require = createRequire(import.meta.url);
const { TARGETS, upstream, binaryName } = require('../magpie-runtime.cjs');

const temporaryDirectories: string[] = [];
const marker = ['open', 'claw'].join('');

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-magpie-gate-'));
  temporaryDirectories.push(root);
  return root;
}

function writePinnedBinary(
  root: string,
  key: string,
  bytes: string,
  manifestPatch: Record<string, unknown> = {},
) {
  const target = TARGETS[key];
  const directory = path.join(root, 'resources', 'magpie', key);
  fs.mkdirSync(directory, { recursive: true });
  const filename = binaryName(key);
  const binary = path.join(directory, filename);
  fs.writeFileSync(binary, bytes);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    schemaVersion: 1,
    platform: target.platform,
    arch: target.arch,
    binary: filename,
    version: upstream.version,
    sha256: digest,
    buildSha256: digest,
    source: { commit: upstream.commit },
    ...manifestPatch,
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  return path.join('resources', 'magpie', key, filename);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts only the pinned gateway binary even when it contains a retired-runtime label', () => {
  const root = temporaryRoot();
  const relativePath = writePinnedBinary(root, 'linux-x64', `gateway ${marker}`);
  expect(isPinnedMagpieGatewayBinary(root, relativePath)).toBe(true);
});

test('still scans every other Magpie resource and a binary that is not the pinned compiler output', () => {
  const root = temporaryRoot();
  const relativePath = writePinnedBinary(root, 'win32-x64', `gateway ${marker}`);
  expect(isPinnedMagpieGatewayBinary(root, 'resources/magpie/README.md')).toBe(false);
  expect(isPinnedMagpieGatewayBinary(root, 'resources/magpie/win32-x64/manifest.json')).toBe(false);
  expect(isPinnedMagpieGatewayBinary(root, 'resources/other/magpie.exe')).toBe(false);
  expect(isPinnedMagpieGatewayBinary(root, 'resources/magpie/win32-x64/magpie')).toBe(false);

  const manifestPath = path.join(root, 'resources', 'magpie', 'win32-x64', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = 'other-version';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(isPinnedMagpieGatewayBinary(root, relativePath)).toBe(false);

  manifest.version = upstream.version;
  manifest.sha256 = 'f'.repeat(64);
  manifest.buildSha256 = manifest.sha256;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(isPinnedMagpieGatewayBinary(root, relativePath)).toBe(false);
});
