import { expect, test } from 'vitest';

import { assertWindowsDownloads } from './verify-github-windows-downloads.mjs';

const version = '2026.11.11-build.1';

function fixture() {
  const manifests = ['lite', 'cpu', 'cuda'].map(variant => ({
    artifacts: [
      {
        platform: 'win32',
        arch: 'x64',
        variant,
        kind: 'installer',
        filename: `ZhiYuanAgent-Setup-${version}.exe`,
        size: 123,
        sha256: 'a'.repeat(64),
      },
    ],
  }));
  const release = {
    tag_name: `v${version}`,
    draft: false,
    assets: manifests.map(({ artifacts: [artifact] }) => ({
      name: `win32-x64-${artifact.variant}-${artifact.filename}`,
      state: 'uploaded',
      size: artifact.size,
      digest: `sha256:${artifact.sha256}`,
    })),
  };
  return { manifests, release };
}

test('accepts only the final public Windows installer bytes for every edition', () => {
  const { manifests, release } = fixture();
  release.assets.push({ name: 'darwin-arm64-cpu.dmg', state: 'uploaded', size: 456, digest: '' });
  expect(() => assertWindowsDownloads(release, manifests, version)).not.toThrow();
});

test('blocks the previous mixed NSIS and WebView2 download page', () => {
  const { manifests, release } = fixture();
  release.assets.push({ ...release.assets[0], name: `win32-x64-lite-Native-Setup-${version}.exe` });
  expect(() => assertWindowsDownloads(release, manifests, version)).toThrow(
    'exactly three Windows WebView2 installers',
  );
});

test.each(['name', 'size', 'digest', 'state'] as const)(
  'rejects a public download with the wrong %s',
  field => {
    const { manifests, release } = fixture();
    const asset = release.assets[0];
    if (field === 'size') asset.size += 1;
    else asset[field] = 'wrong';
    expect(() => assertWindowsDownloads(release, manifests, version)).toThrow();
  },
);

test('rejects missing or repeated installer editions', () => {
  const { manifests, release } = fixture();
  manifests[1].artifacts[0].variant = 'lite';
  expect(() => assertWindowsDownloads(release, manifests, version)).toThrow('complete and unique');
});
