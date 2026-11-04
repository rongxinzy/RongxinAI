import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

describe('rebuild-electron-native-linux-docker.sh', () => {
  test('rebuilds native modules on Ubuntu 22.04 for the glibc baseline', () => {
    const script = readFileSync(
      path.join(root, 'scripts/ci/rebuild-electron-native-linux-docker.sh'),
      'utf8',
    );
    expect(script).toMatch(/ubuntu:22\.04/);
    expect(script).toMatch(/xz-utils/);
    expect(script).toMatch(/electron-rebuild --only better-sqlite3,node-pty/);
    expect(script).not.toMatch(/node-pty\/build\/Release\/spawn-helper/);
    expect(script).toMatch(/require_cmd/);
    expect(script).toMatch(/pty\.node/);
  });
});
