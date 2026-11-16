import { describe, expect, test } from 'vitest';
import {
  listRequiredReleaseTargets,
  isWindowsInferenceVariant,
  parseLinuxReleaseVariant,
  resolveReleaseArtifactFormat,
  resolveReleasePlatforms,
} from './inference-edition-targets.mjs';
import { listReleaseCandidateBundles } from './release-candidate-layout.mjs';

test('release targets: Windows/Linux lite/cuda, macOS Metal per arch', () => {
  expect(listRequiredReleaseTargets()).toEqual([
    'win32:x64:lite',
    'win32:x64:cuda',
    'linux:x64:deb-lite',
    'linux:x64:appimage-lite',
    'linux:x64:deb-cuda',
    'linux:x64:appimage-cuda',
    'darwin:x64:cpu',
    'darwin:arm64:cpu',
  ]);
  expect(parseLinuxReleaseVariant('deb-lite')).toEqual({ format: 'deb', edition: 'lite' });
  expect(parseLinuxReleaseVariant('appimage-lite')).toEqual({ format: 'appimage', edition: 'lite' });
});

test('CPU-only Windows/Linux release targets are rejected', () => {
  expect(isWindowsInferenceVariant('cpu')).toBe(false);
  expect(() => resolveReleaseArtifactFormat('win32', 'cpu')).toThrow('Unsupported release target');
  for (const variant of ['deb-cpu', 'appimage-cpu']) {
    expect(parseLinuxReleaseVariant(variant)).toBeNull();
    expect(() => resolveReleaseArtifactFormat('linux', variant)).toThrow('Unsupported release target');
  }
});

test('release candidate bundles match the 6 build legs', () => {
  expect(listReleaseCandidateBundles().map(bundle => bundle.bundleId)).toEqual([
    'win32-x64-lite',
    'win32-x64-cuda',
    'linux-x64-lite',
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
      'win32:x64:cuda',
    ]);
    expect(listReleaseCandidateBundles(windowsOnly).map(bundle => bundle.bundleId)).toEqual([
      'win32-x64-lite',
      'win32-x64-cuda',
    ]);
    expect(listReleaseCandidateBundles(resolveReleasePlatforms({}))).toHaveLength(6);
    expect(() => resolveReleasePlatforms({ ZHIYUAN_RELEASE_PLATFORM: 'windows' })).toThrow(
      'Unsupported',
    );
  });
});
