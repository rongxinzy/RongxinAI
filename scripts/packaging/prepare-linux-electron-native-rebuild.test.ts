import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  LINUX_BETTER_SQLITE3_PREBUILD_NAMES,
  stripLinuxBetterSqlite3Prebuilds,
} from './prepare-linux-electron-native-rebuild.cjs';

const temporaryDirectories: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-native-prepare-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('prepare-linux-electron-native-rebuild', () => {
  test('removes Linux better-sqlite3 prebuilds that disable gyp force_build', () => {
    const root = tempRoot();
    const prebuildsDir = path.join(root, 'node_modules/better-sqlite3/prebuilds');
    fs.mkdirSync(prebuildsDir, { recursive: true });
    for (const name of LINUX_BETTER_SQLITE3_PREBUILD_NAMES) {
      fs.writeFileSync(path.join(prebuildsDir, name), 'prebuild');
    }
    fs.writeFileSync(path.join(prebuildsDir, 'darwin-x64.node'), 'keep');

    const removed = stripLinuxBetterSqlite3Prebuilds(root);
    expect(removed).toHaveLength(LINUX_BETTER_SQLITE3_PREBUILD_NAMES.length);
    expect(fs.existsSync(path.join(prebuildsDir, 'darwin-x64.node'))).toBe(true);
    for (const name of LINUX_BETTER_SQLITE3_PREBUILD_NAMES) {
      expect(fs.existsSync(path.join(prebuildsDir, name))).toBe(false);
    }
  });

  test('docker rebuild script strips prebuilds before electron-rebuild', () => {
    const script = fs.readFileSync(
      path.join(import.meta.dirname, '../ci/rebuild-electron-native-linux-docker.sh'),
      'utf8',
    );
    expect(script).toMatch(/prepare-linux-electron-native-rebuild\.cjs/);
  });
});
