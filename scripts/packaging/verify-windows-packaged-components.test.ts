import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

import { verifyWindowsCompressedChannelRuntime } from './verify-windows-packaged-components.cjs';

const temporaryDirectories: string[] = [];
const sevenZipPath = path.join(process.cwd(), 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-win-component-verify-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('verifyWindowsPackagedComponents', () => {
  test('verifies channel-runtime from compressed Windows component archives', () => {
    if (process.platform !== 'win32' || !fs.existsSync(sevenZipPath)) {
      return;
    }

    const projectRoot = tempRoot();
    const sidecarBytes = Buffer.from('pinned sidecar');
    const checksum = crypto.createHash('sha256').update(sidecarBytes).digest('hex');
    const componentRoot = path.join(projectRoot, 'vendor', 'channel-runtime', 'current');
    fs.mkdirSync(componentRoot, { recursive: true });
    fs.writeFileSync(path.join(componentRoot, 'cc-connect-sidecar.exe'), sidecarBytes);
    fs.writeFileSync(
      path.join(componentRoot, 'runtime-build-info.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        repo: 'rongxinzy/pi-connect',
        version: 'zhiyuan-sidecar-v4',
        sourceRevision: 'ecf720f875e31b3df3464d820e6c485775719abe',
        target: 'win-x64',
        assetName: 'cc-connect-sidecar-windows-amd64.exe',
        checksum,
      })}\n`,
    );

    const componentsDir = path.join(projectRoot, 'build-tar', 'windows-components');
    fs.mkdirSync(componentsDir, { recursive: true });
    const archivePath = path.join(componentsDir, 'channel-runtime.7z');
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-channel-runtime-pack-'));
    const stagedPrefix = path.join(stagingRoot, 'channel-runtime');
    fs.symlinkSync(componentRoot, stagedPrefix, 'junction');
    const packed = spawnSync(
      sevenZipPath,
      ['a', '-t7z', '-mx=9', '-m0=lzma2', '-ms=off', '-mmt=on', archivePath, 'channel-runtime'],
      { cwd: stagingRoot, encoding: 'utf8' },
    );
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    expect(packed.status).toBe(0);

    const archiveSha256 = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
    fs.writeFileSync(
      path.join(componentsDir, 'channel-runtime.manifest.json'),
      `${JSON.stringify({
        version: 4,
        key: 'channel-runtime',
        label: 'cc-connect channel runtime',
        prefix: 'channel-runtime',
        sentinel: 'channel-runtime/cc-connect-sidecar.exe',
        contentId: 'a'.repeat(64),
        archive: 'channel-runtime.7z',
        archiveFormat: '7z',
        archiveCompression: 'lzma2-mx9-nonsolid-v1',
        archiveSha256,
        archiveSizeBytes: fs.statSync(archivePath).size,
        sentinelSha256: checksum,
      })}\n`,
    );
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      `${JSON.stringify({
        channelRuntime: {
          repo: 'rongxinzy/pi-connect',
          version: 'zhiyuan-sidecar-v4',
          sourceRevision: 'ecf720f875e31b3df3464d820e6c485775719abe',
          runtimeAssets: { 'win-x64': 'cc-connect-sidecar-windows-amd64.exe' },
          runtimeChecksums: { 'win-x64': checksum },
        },
      })}\n`,
    );

    const context = {
      electronPlatformName: 'win32',
      arch: 1,
      appOutDir: path.join(projectRoot, 'release', 'win-unpacked'),
      packager: { projectDir: projectRoot },
    };

    expect(() =>
      verifyWindowsCompressedChannelRuntime(context, 'win-x64', checksum, 'cc-connect-sidecar.exe'),
    ).not.toThrow();
  });
});
