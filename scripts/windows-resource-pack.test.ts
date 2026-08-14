import { createRequire } from 'node:module';

import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  WINDOWS_RESOURCE_ARCHIVE_COMPRESSION,
  getWindowsResourceArchiveCompression,
  getWindowsResourceComponents,
} = require('./windows-resource-pack.cjs');

describe('Windows resource archive compression', () => {
  const components = getWindowsResourceComponents('C:\\project');
  const compressionFor = (key: string) =>
    getWindowsResourceArchiveCompression(components.find(component => component.key === key));

  test('uses BCJ2 with independent LZMA streams for PortableGit', () => {
    expect(compressionFor('portable-git')).toEqual({
      id: 'lzma-bcj2-d128m-mx9-solid-v1',
      sevenZipArgs: [
        '-mx=9',
        '-m0=BCJ2',
        '-m1=LZMA:d=128m',
        '-m2=LZMA:d=128m',
        '-m3=LZMA:d=128m',
        '-mb0:1',
        '-mb0s1:2',
        '-mb0s2:3',
        '-ms=on',
        '-mmt=on',
      ],
    });
  });

  test.each(['skills', 'mcps', 'python', 'skill-python'])('uses solid LZMA2 for %s', key => {
    expect(compressionFor(key)).toBe(WINDOWS_RESOURCE_ARCHIVE_COMPRESSION.Solid);
  });

  test.each(['channel-runtime', 'uv'])('uses non-solid LZMA2 for %s', key => {
    expect(compressionFor(key)).toBe(WINDOWS_RESOURCE_ARCHIVE_COMPRESSION.NonSolid);
  });
});
