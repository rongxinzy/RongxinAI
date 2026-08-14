import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { ELECTRON_RUNTIME_DEPENDENCIES } from '../electron-runtime-dependencies.mjs';
import {
  checkElectronRuntimeDependencies,
  collectLiteralExternalRoots,
} from './check-electron-runtime-dependencies.mjs';

const temporaryDirectories: string[] = [];

function createFixture(mainSource = "require('ajv'); require('node:fs'); require('electron');") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-electron-runtime-test-'));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, 'dist-electron'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      dependencies: Object.fromEntries(ELECTRON_RUNTIME_DEPENDENCIES.map(name => [name, '*'])),
    }),
  );
  fs.writeFileSync(path.join(root, 'dist-electron', 'main.js'), mainSource);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Electron runtime dependency check', () => {
  test('collects package roots while excluding relative and built-in imports', () => {
    expect(
      collectLiteralExternalRoots(
        "require('@scope/package/file'); import('debug/src/index.js'); require('./local'); require('fs');",
      ),
    ).toEqual(['@scope/package', 'debug']);
  });

  test('accepts a complete runtime dependency closure without source maps', () => {
    expect(checkElectronRuntimeDependencies(createFixture()).externalRoots).toEqual(['ajv']);
  });

  test('rejects production dependency allowlist drift', () => {
    const root = createFixture();
    const packageJsonPath = path.join(root, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    packageJson.dependencies.react = '*';
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson));

    expect(() => checkElectronRuntimeDependencies(root)).toThrow(
      'Production dependencies must match the Electron runtime allowlist',
    );
  });

  test('rejects undeclared generated externals', () => {
    expect(() =>
      checkElectronRuntimeDependencies(createFixture("require('missing-package')")),
    ).toThrow('undeclared runtime dependencies: missing-package');
  });

  test('rejects Electron source maps', () => {
    const root = createFixture();
    fs.writeFileSync(path.join(root, 'dist-electron', 'main.js.map'), '{}');

    expect(() => checkElectronRuntimeDependencies(root)).toThrow(
      'Production Electron output contains source maps',
    );
  });
});
