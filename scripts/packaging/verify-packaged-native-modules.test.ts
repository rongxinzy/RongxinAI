import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  findPackagedNodePtyBinding,
  verifyPackagedNodePty,
} from './verify-packaged-native-modules.cjs';

const temporaryDirectories: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-packaged-native-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function writePackagedPty(appOutDir: string, relativePath: string) {
  const absolute = path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    relativePath,
  );
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, Buffer.from('native'));
  return absolute;
}

describe('verifyPackagedNodePty', () => {
  test('finds a packaged linux-x64 pty.node under asar unpack', () => {
    const appOutDir = tempRoot();
    const binding = writePackagedPty(appOutDir, 'build/Release/pty.node');
    expect(findPackagedNodePtyBinding(appOutDir)).toBe(binding);
  });

  test('rejects packaged node-pty when spawn-helper is missing', () => {
    const appOutDir = tempRoot();
    writePackagedPty(appOutDir, 'build/Release/pty.node');
    expect(() =>
      verifyPackagedNodePty({
        electronPlatformName: 'linux',
        appOutDir,
      }),
    ).toThrow(/spawn-helper/);
  });

  test('rejects linux packages without a loadable pty binding', () => {
    const appOutDir = tempRoot();
    fs.mkdirSync(
      path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty'),
      {
        recursive: true,
      },
    );
    expect(findPackagedNodePtyBinding(appOutDir)).toBeNull();
    expect(() =>
      verifyPackagedNodePty({
        electronPlatformName: 'linux',
        appOutDir,
      }),
    ).toThrow(/Missing packaged node-pty binding/);
  });

  test('does not require node-pty verification on non-linux targets', () => {
    expect(() =>
      verifyPackagedNodePty({
        electronPlatformName: 'darwin',
        appOutDir: tempRoot(),
      }),
    ).not.toThrow();
  });
});
