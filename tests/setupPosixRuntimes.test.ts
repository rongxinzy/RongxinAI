import { describe, expect, it } from 'vitest';

const uv = require('../scripts/setup-mac-uv-runtime.js') as {
  targetAsset: (platform: string, arch: string) => string | null;
};

describe('bundled uv targets', () => {
  it('selects official macOS and Ubuntu archives', () => {
    expect(uv.targetAsset('darwin', 'arm64')).toBe('uv-aarch64-apple-darwin.tar.gz');
    expect(uv.targetAsset('darwin', 'x64')).toBe('uv-x86_64-apple-darwin.tar.gz');
    expect(uv.targetAsset('linux', 'x64')).toBe('uv-x86_64-unknown-linux-gnu.tar.gz');
    expect(uv.targetAsset('linux', 'arm64')).toBe('uv-aarch64-unknown-linux-gnu.tar.gz');
  });
});
