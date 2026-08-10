import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  buildWindowsResourcePackManifest,
  computeWindowsResourcePackId,
  isWindowsResourcePackReusable,
} from '../scripts/windows-resource-pack.cjs';

const temporaryDirectories: string[] = [];

function createSource() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-resource-pack-test-'));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nested', 'runtime.exe'), 'runtime-v1');
  return [{ label: 'runtime', dir: root, prefix: 'runtime' }];
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Windows offline resource pack identity', () => {
  test('is stable when only source mtimes change', () => {
    const sources = createSource();
    const before = computeWindowsResourcePackId(sources);
    const runtimePath = path.join(sources[0].dir, 'nested', 'runtime.exe');
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(runtimePath, future, future);

    expect(computeWindowsResourcePackId(sources)).toBe(before);
  });

  test('changes when packaged bytes change', () => {
    const sources = createSource();
    const before = computeWindowsResourcePackId(sources);
    fs.writeFileSync(path.join(sources[0].dir, 'nested', 'runtime.exe'), 'runtime-v2');

    expect(computeWindowsResourcePackId(sources)).not.toBe(before);
  });

  test('reuses only a manifest with the same content ID and source layout', () => {
    const sources = createSource();
    const resourcePackId = computeWindowsResourcePackId(sources);
    const manifestPath = path.join(sources[0].dir, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(buildWindowsResourcePackManifest(sources, resourcePackId), null, 2)}\n`,
    );

    expect(isWindowsResourcePackReusable(manifestPath, resourcePackId, sources)).toBe(true);
    expect(isWindowsResourcePackReusable(manifestPath, '0'.repeat(64), sources)).toBe(false);
  });
});
