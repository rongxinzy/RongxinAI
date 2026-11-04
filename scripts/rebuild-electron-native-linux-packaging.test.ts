import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

describe('rebuild-electron-native-linux-packaging', () => {
  test('predist:linux uses the Docker-backed Linux packaging rebuild', () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['predist:linux']).toContain(
      'rebuild:electron-native:linux-packaging',
    );
    expect(packageJson.scripts['predist:linux']).not.toContain('rebuild:electron-native &&');
  });

  test('verifies glibc after the Docker rebuild script', () => {
    const entry = readFileSync(
      path.join(root, 'scripts/rebuild-electron-native-linux-packaging.cjs'),
      'utf8',
    );
    expect(entry).toMatch(/rebuild-electron-native-linux-docker\.sh/);
    expect(entry).toMatch(/assertMaxGlibcVersion/);
  });
});
