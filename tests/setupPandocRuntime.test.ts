import { describe, expect, it } from 'vitest';

const { targetAsset } = require('../scripts/setup-pandoc-runtime.js') as {
  targetAsset: (platform: string, arch: string) => string | null;
};

describe('bundled Pandoc runtime', () => {
  it('selects official archives for each packaged desktop target', () => {
    expect(targetAsset('win32', 'x64')).toBe('pandoc-3.9.0.2-windows-x86_64.zip');
    expect(targetAsset('darwin', 'arm64')).toBe('pandoc-3.9.0.2-arm64-macOS.zip');
    expect(targetAsset('darwin', 'x64')).toBe('pandoc-3.9.0.2-x86_64-macOS.zip');
    expect(targetAsset('linux', 'x64')).toBeNull();
  });
});
