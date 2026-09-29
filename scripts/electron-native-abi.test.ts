import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

import {
  classifyNativeAbi,
  describeNativeAbi,
  inspectNativeAbi,
  NativeAbiStatus,
  NativeAbiProbeExitCode,
} from './electron-native-abi.mjs';

const requireFromProject = createRequire(path.join(process.cwd(), 'package.json'));
const electronBinary: string = requireFromProject('electron');
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function fixture(source: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-native-probe-'));
  tempDirs.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  for (const name of ['electron', 'better-sqlite3']) {
    fs.mkdirSync(path.join(root, 'node_modules', name), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, 'node_modules/electron/index.js'),
    `module.exports = ${JSON.stringify(electronBinary)};`,
  );
  fs.writeFileSync(path.join(root, 'node_modules/better-sqlite3/index.js'), source);
  return root;
}

test('accepts only a successful lazy database open in the installed Electron', () => {
  const root = fixture(`module.exports = class {
    constructor(filename) {
      if (!process.versions.electron || filename !== ':memory:') throw new Error('wrong probe');
    }
    prepare() { return { get: () => 1 }; }
    close() {}
  };`);
  expect(inspectNativeAbi(root)).toBe(NativeAbiStatus.Compatible);
});

test.each([115, 137, 999])(
  'rejects an addon with module ABI %s instead of inferring compatibility',
  abi => {
    const root = fixture(`module.exports = class {
    constructor() { throw new Error('compiled against NODE_MODULE_VERSION ${abi}; requires a different NODE_MODULE_VERSION'); }
  };`);
    expect(inspectNativeAbi(root)).toBe(NativeAbiStatus.Incompatible);
    expect(describeNativeAbi(NativeAbiStatus.Incompatible)).toContain(
      'npm run rebuild:electron-native',
    );
  },
);

test('reports a missing addon or runtime as unavailable', () => {
  const root = fixture("throw new Error('Cannot find native binding');");
  expect(inspectNativeAbi(root)).toBe(NativeAbiStatus.Unavailable);
  const missingRuntime = fixture('module.exports = class {};');
  fs.rmSync(path.join(missingRuntime, 'node_modules/electron/index.js'));
  expect(inspectNativeAbi(missingRuntime)).toBe(NativeAbiStatus.Unavailable);
});

test('does not accept an unrelated successful executable as an Electron probe', () => {
  const root = fixture(
    'module.exports = class { prepare() { return { get: () => 1 }; } close() {} };',
  );
  fs.writeFileSync(
    path.join(root, 'node_modules/electron/index.js'),
    `module.exports = ${JSON.stringify(process.execPath)};`,
  );
  // When this suite runs in Electron, the installed runtime remains valid.
  if (!process.versions.electron) expect(inspectNativeAbi(root)).toBe(NativeAbiStatus.Unavailable);
  const probe = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'scripts/electron-native-abi-probe.cjs')],
    {
      windowsHide: true,
    },
  );
  expect(probe.status).toBe(NativeAbiProbeExitCode.Unavailable);
});

test('classifies target-runtime mismatches as incompatible', () => {
  expect(classifyNativeAbi(null)).toBe(NativeAbiStatus.Compatible);
  expect(classifyNativeAbi(new Error('NODE_MODULE_VERSION 115'))).toBe(
    NativeAbiStatus.Incompatible,
  );
  expect(classifyNativeAbi(new Error('missing binding'))).toBe(NativeAbiStatus.Unavailable);
});

test('terminates an unresponsive native module probe', () => {
  const root = fixture('module.exports = class { constructor() { while (true) {} } };');
  const started = Date.now();
  expect(inspectNativeAbi(root)).toBe(NativeAbiStatus.Unavailable);
  expect(Date.now() - started).toBeLessThan(15_000);
});
