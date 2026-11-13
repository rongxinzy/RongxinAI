import { describe, it, expect } from 'vitest';

import fs from 'node:fs/promises';

import path from 'node:path';

import { isolatedMagpieEnvironment, prepareMagpieHome } from './environment';

import {
  verifyMagpieBinary,
  assertPeHasAuthenticodeSignature,
  MAGPIE_COMMIT,
  MAGPIE_VERSION,
} from './integrity';

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

  it('recovers corrupted or truncated settings.json atomically with backup', async () => {
    const root = await temporary();
    const configDir = path.join(root, 'config', 'magpie');
    const settingsFile = path.join(configDir, 'settings.json');
    try {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(settingsFile, '{"broken":\0\0\0');
      await prepareMagpieHome(root);

      const repaired = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
      expect(repaired).toMatchObject({
        noAccountDiscovery: true,
        noWSLAgents: true,
        noStats: true,
        noUsageStats: true,
        noAutoUpdate: true,
        lan: false,
        gatewayMode: 'off',
      });
      const files = await fs.readdir(configDir);
      expect(files.some(name => name.startsWith('settings.json.corrupt-'))).toBe(true);
      expect(files.some(name => name.endsWith('.tmp'))).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('validates manifest signing metadata and PE Authenticode certificate table', async () => {
    const root = await temporary();
    const dir = path.join(root, `${process.platform}-${process.arch}`);
    await fs.mkdir(dir);
    const binary = process.platform === 'win32' ? 'magpie.exe' : 'magpie';
    const expectedFormat =
      process.platform === 'win32'
        ? 'authenticode'
        : process.platform === 'darwin'
          ? 'codesign'
          : undefined;
    const baseManifest = {
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      binary,
      source: { commit: MAGPIE_COMMIT },
      version: MAGPIE_VERSION,
      sha256: 'a'.repeat(64),
      buildSha256: 'b'.repeat(64),
    };
    try {
      if (expectedFormat) {
        await fs.writeFile(
          path.join(dir, 'manifest.json'),
          JSON.stringify({
            ...baseManifest,
            signing: { platform: process.platform, format: 'wrong' },
          }),
        );
        await expect(
          verifyMagpieBinary(root, new AbortController().signal, async () => 'a'.repeat(64)),
        ).rejects.toThrow('signing seal');

        await fs.writeFile(
          path.join(dir, 'manifest.json'),
          JSON.stringify({
            ...baseManifest,
            buildSha256: 'a'.repeat(64),
            signing: { platform: process.platform, format: expectedFormat },
          }),
        );
        await expect(
          verifyMagpieBinary(root, new AbortController().signal, async () => 'a'.repeat(64)),
        ).rejects.toThrow('signing seal');

        let sigChecks = 0;
        await fs.writeFile(
          path.join(dir, 'manifest.json'),
          JSON.stringify({
            ...baseManifest,
            signing: { platform: process.platform, format: expectedFormat },
          }),
        );
        await verifyMagpieBinary(root, new AbortController().signal, async () => 'a'.repeat(64), {
          verifySignature: async () => {
            sigChecks += 1;
          },
        });
        expect(sigChecks).toBe(1);
      }

      // Synthetic minimal PE32+ executable with an embedded WIN_CERTIFICATE entry.
      const pePath = path.join(root, 'fake-magpie.exe');
      const peOffset = 0x80;
      const optionalSize = 0xf0;
      const certOffset = 0x200;
      const certBytes = 16;
      const buf = Buffer.alloc(certOffset + certBytes);
      buf.write('MZ', 0, 'ascii');
      buf.writeUInt32LE(peOffset, 60);
      buf.writeUInt32LE(0x4550, peOffset); // PE\0\0
      buf.writeUInt16LE(1, peOffset + 6); // 1 section
      buf.writeUInt16LE(optionalSize, peOffset + 20);
      buf.writeUInt16LE(0x20b, peOffset + 24); // PE32+
      buf.writeUInt32LE(16, peOffset + 24 + 108); // NumberOfRvaAndSizes
      buf.writeUInt32LE(certOffset, peOffset + 24 + 144); // Security Dir offset
      buf.writeUInt32LE(certBytes, peOffset + 24 + 148); // Security Dir size
      buf.writeUInt32LE(certBytes, certOffset); // dwLength
      buf.writeUInt16LE(0x200, certOffset + 4); // WIN_CERT_REVISION_2_0
      buf.writeUInt16LE(2, certOffset + 6); // WIN_CERT_TYPE_PKCS_SIGNED_DATA
      await fs.writeFile(pePath, buf);
      await expect(assertPeHasAuthenticodeSignature(pePath)).resolves.toBeUndefined();

      // Stripping certificate table must fail immediately.
      buf.writeUInt32LE(0, peOffset + 24 + 144);
      buf.writeUInt32LE(0, peOffset + 24 + 148);
      await fs.writeFile(pePath, buf);
      await expect(assertPeHasAuthenticodeSignature(pePath)).rejects.toThrow(
        'Authenticode certificate table',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
