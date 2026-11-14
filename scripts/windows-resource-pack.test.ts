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

  test.each(['skills', 'mcps', 'python', 'skill-python'])('uses solid LZMA2 for %s', key => {
    expect(compressionFor(key)).toBe(WINDOWS_RESOURCE_ARCHIVE_COMPRESSION.Solid);
  });

  test.each(['uv'])('uses non-solid LZMA2 for %s', key => {
    expect(compressionFor(key)).toBe(WINDOWS_RESOURCE_ARCHIVE_COMPRESSION.NonSolid);
  });
});
