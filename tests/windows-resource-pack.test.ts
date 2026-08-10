import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  buildWindowsResourceBundleManifest,
  buildWindowsResourceComponentManifest,
  computeWindowsResourceComponentId,
  isWindowsResourceComponentReusable,
  sha256File,
} from '../scripts/windows-resource-pack.cjs';

const temporaryDirectories: string[] = [];

function createComponent(key = 'runtime') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-resource-component-test-'));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nested', 'runtime.exe'), 'runtime-v1');
  return {
    key,
    label: key,
    dir: root,
    prefix: key,
    sentinel: key + '/nested/runtime.exe',
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Windows offline component identity', () => {
  test('is stable when only source mtimes change', () => {
    const component = createComponent();
    const before = computeWindowsResourceComponentId(component);
    const runtimePath = path.join(component.dir, 'nested', 'runtime.exe');
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(runtimePath, future, future);

    expect(computeWindowsResourceComponentId(component)).toBe(before);
  });

  test('changes only for a component whose packaged bytes change', () => {
    const first = createComponent('first');
    const second = createComponent('second');
    const firstBefore = computeWindowsResourceComponentId(first);
    const secondBefore = computeWindowsResourceComponentId(second);
    fs.writeFileSync(path.join(first.dir, 'nested', 'runtime.exe'), 'runtime-v2');

    expect(computeWindowsResourceComponentId(first)).not.toBe(firstBefore);
    expect(computeWindowsResourceComponentId(second)).toBe(secondBefore);
  });

  test('reuses only an archive whose manifest, size, and SHA-256 still match', () => {
    const component = createComponent();
    const contentId = computeWindowsResourceComponentId(component);
    const archivePath = path.join(component.dir, 'runtime.tar');
    const manifestPath = path.join(component.dir, 'manifest.json');
    fs.writeFileSync(archivePath, 'archive-v1');
    const manifest = buildWindowsResourceComponentManifest(
      component,
      contentId,
      sha256File(archivePath),
      fs.statSync(archivePath).size,
      sha256File(path.join(component.dir, 'nested', 'runtime.exe')),
    );
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(
      isWindowsResourceComponentReusable(manifestPath, archivePath, contentId, component),
    ).toBe(true);
    fs.writeFileSync(archivePath, 'archive-v2');
    expect(
      isWindowsResourceComponentReusable(manifestPath, archivePath, contentId, component),
    ).toBe(false);
  });

  test('records a digest for the component health-check file', () => {
    const component = createComponent();
    const archivePath = path.join(component.dir, 'runtime.tar');
    fs.writeFileSync(archivePath, 'archive-v1');
    const manifest = buildWindowsResourceComponentManifest(
      component,
      computeWindowsResourceComponentId(component),
      sha256File(archivePath),
      fs.statSync(archivePath).size,
      sha256File(path.join(component.dir, 'nested', 'runtime.exe')),
    );

    expect(manifest.sentinelSha256).toBe(
      sha256File(path.join(component.dir, 'nested', 'runtime.exe')),
    );
  });

  test('marks the aggregate manifest as offline and llama.cpp-free', () => {
    const manifest = buildWindowsResourceBundleManifest([]);
    expect(manifest.offline).toBe(true);
    expect(manifest.excludes).toContain('llama.cpp');
  });
});
