import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

import {
  assertDeveloperIdHardenedRuntime,
  assertSealedMagpieManifest,
  verifyPackagedMagpieApp,
} from './verify-packaged-magpie-signature.mjs';

const require = createRequire(import.meta.url);
const { upstream } = require('../magpie-runtime.cjs');

const temporaryDirectories: string[] = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-magpie-sign-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('recognizes a Developer ID signature with the hardened runtime', () => {
  const info = [
    'Identifier=magpie',
    'flags=0x10000(runtime)',
    'Authority=Developer ID Application: Example (TEAMID)',
    'Authority=Apple Root CA',
  ].join('\n');
  expect(() => assertDeveloperIdHardenedRuntime(info)).not.toThrow();
  expect(() => assertDeveloperIdHardenedRuntime(info.replace('runtime', 'library'))).toThrow(
    'hardened runtime',
  );
  expect(() =>
    assertDeveloperIdHardenedRuntime(info.replace('Developer ID Application', 'Apple Development')),
  ).toThrow('Developer ID');
});

test('requires the sealed manifest to keep the compiler digest and the shipped digest apart', () => {
  const digest = 'a'.repeat(64);
  const manifest = {
    version: upstream.version,
    source: { commit: upstream.commit },
    sha256: digest,
    buildSha256: 'b'.repeat(64),
    signing: { platform: 'darwin', format: 'codesign' },
  };
  expect(() => assertSealedMagpieManifest(manifest, digest)).not.toThrow();
  expect(() => assertSealedMagpieManifest({ ...manifest, sha256: 'c'.repeat(64) }, digest)).toThrow(
    'SHA-256',
  );
  expect(() => assertSealedMagpieManifest({ ...manifest, buildSha256: digest }, digest)).toThrow(
    'compiler digest',
  );
});

function writeSignedHelper(app: string, key: string) {
  const directory = path.join(app, 'Contents', 'Resources', 'magpie', key);
  fs.mkdirSync(directory, { recursive: true });
  const bytes = `signed ${key}`;
  fs.writeFileSync(path.join(directory, 'magpie'), bytes);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(
    path.join(directory, 'manifest.json'),
    JSON.stringify({
      version: upstream.version,
      source: { commit: upstream.commit },
      sha256: digest,
      buildSha256: 'd'.repeat(64),
      signing: { platform: 'darwin', format: 'codesign' },
    }),
  );
}

function fakeCodesign(verified: string[]) {
  return {
    execFile: (_command: string, args: string[]) => {
      verified.push(args[args.length - 1] ?? '');
    },
    spawn: () => ({
      status: 0,
      stdout: '',
      stderr: 'flags=0x10000(runtime)\nAuthority=Developer ID Application: Example (TEAMID)\n',
    }),
  };
}

test('checks both packaged macOS helpers of a universal app', () => {
  const app = path.join(temporaryRoot(), 'App.app');
  const verified: string[] = [];
  for (const key of ['darwin-x64', 'darwin-arm64']) writeSignedHelper(app, key);
  verifyPackagedMagpieApp(app, fakeCodesign(verified));
  expect(verified).toHaveLength(2);
  expect(verified.every(filename => filename.endsWith(`${path.sep}magpie`))).toBe(true);
});

test('checks only the helper a per-arch app ships', () => {
  const app = path.join(temporaryRoot(), 'App.app');
  const verified: string[] = [];
  writeSignedHelper(app, 'darwin-arm64');
  verifyPackagedMagpieApp(app, fakeCodesign(verified), ['darwin-arm64']);
  expect(verified).toEqual([
    path.join(app, 'Contents', 'Resources', 'magpie', 'darwin-arm64', 'magpie'),
  ]);
});

test('fails when the expected architecture helper is missing', () => {
  const app = path.join(temporaryRoot(), 'App.app');
  writeSignedHelper(app, 'darwin-arm64');
  expect(() => verifyPackagedMagpieApp(app, fakeCodesign([]), ['darwin-x64'])).toThrow(
    'Packaged Magpie binary is missing',
  );
  expect(() => verifyPackagedMagpieApp(app, fakeCodesign([]), ['linux-x64'])).toThrow(
    'Unknown macOS Magpie target',
  );
  const empty = path.join(temporaryRoot(), 'Empty.app');
  fs.mkdirSync(empty);
  expect(() => verifyPackagedMagpieApp(empty, fakeCodesign([]))).toThrow(
    'No packaged macOS Magpie helper',
  );
});
