import { describe, expect, test } from 'vitest';

import {
  assertMaxGlibcVersion,
  extractGlibcSymbolVersions,
  formatGlibcVersion,
  maxGlibcVersionFromSymbols,
} from './linux-glibc-version.cjs';

describe('linux glibc version parsing', () => {
  test('extracts the highest GLIBC symbol version from objdump output', () => {
    const sample = `
      foo  GLIBC_2.17  bar
      baz  GLIBC_2.35  qux
      one  GLIBC_2.34  two
    `;
    const versions = extractGlibcSymbolVersions(sample);
    expect(formatGlibcVersion(maxGlibcVersionFromSymbols(versions))).toBe('2.35');
  });

  test('assertMaxGlibcVersion rejects binaries above the Ubuntu 22.04 baseline', () => {
    const objdump = `
      entry  GLIBC_2.41  sym
      entry  GLIBC_2.42  sym
    `;
    const versions = extractGlibcSymbolVersions(objdump);
    expect(formatGlibcVersion(maxGlibcVersionFromSymbols(versions))).toBe('2.42');
    expect(() => assertMaxGlibcVersion('/tmp/ignored', '2.35', { objdumpOutput: objdump })).toThrow(
      /exceeds the packaged Linux baseline/,
    );
  });
});
