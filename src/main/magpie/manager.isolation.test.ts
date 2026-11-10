import { describe, it, expect } from 'vitest';

import fs from 'node:fs/promises';

import path from 'node:path';

import { isolatedMagpieEnvironment, prepareMagpieHome } from './environment';

import { verifyMagpieBinary, MAGPIE_COMMIT, MAGPIE_VERSION } from './integrity';

import { temporary } from './manager.testHarness';
describe('Magpie isolation and integrity', () => {
  it('keeps real CLI home while isolating service settings and dropping credential environment', () => {
    const env = isolatedMagpieEnvironment('/private', 1234, 'test', {
      HOME: '/real',
      USERPROFILE: '/real',
      OPENAI_API_KEY: 'secret',
      MAGPIE_ADDR: '0.0.0.0:9999',
      PATH: '/bin',
    });
    expect(env.HOME).toBe('/real');
    expect(env.XDG_CONFIG_HOME).toBe('/private/config');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.MAGPIE_ADDR).toBe('127.0.0.1:1234');
    expect(env.MAGPIE_NO_ACCOUNTS).toBe('1');
    expect(env.DO_NOT_TRACK).toBe('1');
    expect(
      isolatedMagpieEnvironment('/private', 1234, 'test', { HOME: '/real' }, true)
        .MAGPIE_NO_ACCOUNTS,
    ).toBe('0');
  });
  it('binds the gateway on 0.0.0.0 only when LAN access is enabled', () => {
    const base = { HOME: '/real' };
    expect(isolatedMagpieEnvironment('/private', 1234, 'test', base, false, true).MAGPIE_ADDR).toBe(
      '0.0.0.0:1234',
    );
    expect(isolatedMagpieEnvironment('/private', 1234, 'test', base, true, true).MAGPIE_ADDR).toBe(
      '0.0.0.0:1234',
    );
    expect(
      isolatedMagpieEnvironment('/private', 1234, 'test', base, false, false).MAGPIE_ADDR,
    ).toBe('127.0.0.1:1234');
  });
  it('forces private no-account, no-telemetry and no-update settings without touching home', async () => {
    const root = await temporary();
    try {
      await prepareMagpieHome(root);
      const value = JSON.parse(
        await fs.readFile(path.join(root, 'config/magpie/settings.json'), 'utf8'),
      );
      expect(value).toMatchObject({
        noAccountDiscovery: true,
        noWSLAgents: true,
        noAutoUpdate: true,
        noStats: true,
        noUsageStats: true,
        lan: false,
        gatewayMode: 'off',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('requires pinned platform manifest and verified binary bytes', async () => {
    const root = await temporary();
    const dir = path.join(root, `${process.platform}-${process.arch}`);
    await fs.mkdir(dir);
    const binary = process.platform === 'win32' ? 'magpie.exe' : 'magpie';
    const manifest = {
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      binary,
      source: { commit: MAGPIE_COMMIT },
      version: MAGPIE_VERSION,
      sha256: 'a'.repeat(64),
    };
    try {
      await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
      await expect(
        verifyMagpieBinary(root, new AbortController().signal, async () => 'b'.repeat(64)),
      ).rejects.toThrow('integrity');
      expect(
        await verifyMagpieBinary(root, new AbortController().signal, async () => 'a'.repeat(64)),
      ).toBe(path.join(dir, binary));
      await fs.writeFile(
        path.join(dir, 'manifest.json'),
        JSON.stringify({ ...manifest, source: { commit: 'moving-main' } }),
      );
      await expect(
        verifyMagpieBinary(root, new AbortController().signal, async () => 'a'.repeat(64)),
      ).rejects.toThrow('manifest');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
