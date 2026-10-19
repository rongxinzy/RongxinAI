import { describe, expect, test } from 'vitest';
import {
  listRequiredReleaseTargets,
  parseLinuxReleaseVariant,
  resolveReleasePlatforms,
} from './inference-edition-targets.mjs';
import { listReleaseCandidateBundles } from './release-candidate-layout.mjs';

// Edition matrix (krli, 2026-10-17): lite is Windows-only.
test('release targets: Windows lite/cpu/cuda, Linux cpu/cuda, macOS cpu per arch', () => {
  expect(listRequiredReleaseTargets()).toEqual([
    'win32:x64:lite',
    'win32:x64:cpu',
    'win32:x64:cuda',
    'linux:x64:deb-cpu',
    'linux:x64:appimage-cpu',
    'linux:x64:deb-cuda',
    'linux:x64:appimage-cuda',
    'darwin:x64:cpu',
    'darwin:arm64:cpu',
  ]);
  expect(parseLinuxReleaseVariant('deb-lite')).toBeNull();
});

test('release candidate bundles match the 7 build legs', () => {
  expect(listReleaseCandidateBundles().map(bundle => bundle.bundleId)).toEqual([
    'win32-x64-lite',
    'win32-x64-cpu',
    'win32-x64-cuda',
    'linux-x64-cpu',
    'linux-x64-cuda',
    'darwin-arm64-cpu',
    'darwin-x64-cpu',
  ]);
});

describe('ZHIYUAN_RELEASE_PLATFORM', () => {
  test('narrows targets and candidate bundles to the selected platform stage', () => {
    const windowsOnly = resolveReleasePlatforms({ ZHIYUAN_RELEASE_PLATFORM: 'win32' });
    expect(listRequiredReleaseTargets(windowsOnly)).toEqual([
      'win32:x64:lite',
      'win32:x64:cpu',
      'win32:x64:cuda',
    ]);
    expect(listReleaseCandidateBundles(windowsOnly).map(bundle => bundle.bundleId)).toEqual([
      'win32-x64-lite',
      'win32-x64-cpu',
      'win32-x64-cuda',
    ]);
    expect(listReleaseCandidateBundles(resolveReleasePlatforms({}))).toHaveLength(7);
    expect(() => resolveReleasePlatforms({ ZHIYUAN_RELEASE_PLATFORM: 'windows' })).toThrow(
      'Unsupported',
    );
  });
});
