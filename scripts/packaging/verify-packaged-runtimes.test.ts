import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  verifyNoRetiredRuntimeArtifacts,
  verifyPackagedChannelRuntime,
} from './verify-packaged-runtimes.cjs';

const temporaryDirectories: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-packaged-runtime-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('verifyPackagedRuntimes', () => {
  test('rejects retired runtime paths inside packaged app output', () => {
    const appOutDir = tempRoot();
    fs.mkdirSync(path.join(appOutDir, 'resources', 'openclaw'), { recursive: true });
    const context = { appOutDir, electronPlatformName: 'linux', packager: { projectDir: appOutDir } };
    expect(() => verifyNoRetiredRuntimeArtifacts(context)).toThrow('retired runtime path');
  });

  test('verifies packaged channel sidecar sha256 against package.json pin', () => {
    const projectRoot = tempRoot();
    const appOutDir = path.join(projectRoot, 'out');
    const sidecarBytes = Buffer.from('pinned sidecar');
    const actualChecksum = crypto.createHash('sha256').update(sidecarBytes).digest('hex');

    fs.mkdirSync(path.join(appOutDir, 'resources', 'channel-runtime'), { recursive: true });
    fs.writeFileSync(path.join(appOutDir, 'resources', 'channel-runtime', 'cc-connect-sidecar'), sidecarBytes);
    fs.writeFileSync(
      path.join(appOutDir, 'resources', 'channel-runtime', 'runtime-build-info.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        repo: 'rongxinzy/pi-connect',
        version: 'zhiyuan-sidecar-v4',
        sourceRevision: 'ecf720f875e31b3df3464d820e6c485775719abe',
        target: 'linux-x64',
        assetName: 'sidecar-linux-x64.tgz',
        checksum: actualChecksum,
      })}\n`,
    );
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      `${JSON.stringify({
        channelRuntime: {
          repo: 'rongxinzy/pi-connect',
          version: 'zhiyuan-sidecar-v4',
          sourceRevision: 'ecf720f875e31b3df3464d820e6c485775719abe',
          runtimeAssets: { 'linux-x64': 'sidecar-linux-x64.tgz' },
          runtimeChecksums: { 'linux-x64': actualChecksum },
        },
      })}\n`,
    );

    const context = {
      appOutDir,
      arch: 1,
      electronPlatformName: 'linux',
      packager: {
        projectDir: projectRoot,
        appInfo: { productFilename: 'ZhiYuan' },
      },
    };
    expect(() => verifyPackagedChannelRuntime(context)).not.toThrow();
  });
});
