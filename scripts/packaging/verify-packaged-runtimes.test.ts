import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  resolveTargetArch,
  verifyNoRetiredRuntimeArtifacts,
  verifyPackagedChannelRuntime,
  verifyPackagedLlamaCppBundled,
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
  delete process.env.ZHIYUAN_UPDATE_VARIANT;
});

function writeChannelRuntimeFixture(options: {
  projectRoot: string;
  appOutDir: string;
  sidecarBytes: Buffer;
  checksumOverride?: string;
  includeBuildInfo?: boolean;
  pinTargetId?: string;
}) {
  const {
    projectRoot,
    appOutDir,
    sidecarBytes,
    checksumOverride,
    includeBuildInfo = true,
    pinTargetId = 'linux-x64',
  } = options;
  const actualChecksum = crypto.createHash('sha256').update(sidecarBytes).digest('hex');
  const checksum = checksumOverride ?? actualChecksum;

  fs.mkdirSync(path.join(appOutDir, 'resources', 'channel-runtime'), { recursive: true });
  fs.writeFileSync(path.join(appOutDir, 'resources', 'channel-runtime', 'cc-connect-sidecar'), sidecarBytes);

  if (includeBuildInfo) {
    fs.writeFileSync(
      path.join(appOutDir, 'resources', 'channel-runtime', 'runtime-build-info.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        repo: 'rongxinzy/pi-connect',
        version: 'zhiyuan-sidecar-v4',
        sourceRevision: 'ecf720f875e31b3df3464d820e6c485775719abe',
        target: pinTargetId,
        assetName: 'sidecar-linux-x64.tgz',
        checksum,
      })}\n`,
    );
  }

  const runtimeAssets: Record<string, string> = {};
  const runtimeChecksums: Record<string, string> = {};
  if (pinTargetId) {
    runtimeAssets[pinTargetId] = 'sidecar-linux-x64.tgz';
    runtimeChecksums[pinTargetId] = checksum;
  }

  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify({
      channelRuntime: {
        repo: 'rongxinzy/pi-connect',
        version: 'zhiyuan-sidecar-v4',
        sourceRevision: 'ecf720f875e31b3df3464d820e6c485775719abe',
        runtimeAssets,
        runtimeChecksums,
      },
    })}\n`,
  );

  return { actualChecksum, checksum };
}

function linuxPackagingContext(projectRoot: string, appOutDir: string) {
  return {
    appOutDir,
    arch: 1,
    electronPlatformName: 'linux',
    packager: {
      projectDir: projectRoot,
      appInfo: { productFilename: 'ZhiYuan' },
    },
  };
}

describe('verifyPackagedRuntimes', () => {
  test('rejects retired runtime paths inside packaged app output', () => {
    const appOutDir = tempRoot();
    const retiredRuntimeDir = ['open', 'claw'].join('');
    fs.mkdirSync(path.join(appOutDir, 'resources', retiredRuntimeDir), { recursive: true });
    const context = { appOutDir, electronPlatformName: 'linux', packager: { projectDir: appOutDir } };
    expect(() => verifyNoRetiredRuntimeArtifacts(context)).toThrow('retired runtime path');
  });

  test('resolveTargetArch throws for unknown electron-builder arch', () => {
    expect(() => resolveTargetArch({ arch: 99 })).toThrow('Unknown packaging arch');
    expect(() => resolveTargetArch({})).toThrow('Unknown packaging arch');
  });

  test('verifies packaged channel sidecar sha256 against package.json pin', () => {
    const projectRoot = tempRoot();
    const appOutDir = path.join(projectRoot, 'out');
    const sidecarBytes = Buffer.from('pinned sidecar');
    writeChannelRuntimeFixture({ projectRoot, appOutDir, sidecarBytes });

    expect(() => verifyPackagedChannelRuntime(linuxPackagingContext(projectRoot, appOutDir))).not.toThrow();
  });

  test('rejects channel sidecar when sha256 does not match package.json pin', () => {
    const projectRoot = tempRoot();
    const appOutDir = path.join(projectRoot, 'out');
    const sidecarBytes = Buffer.from('pinned sidecar');
    const { actualChecksum } = writeChannelRuntimeFixture({ projectRoot, appOutDir, sidecarBytes });
    const wrongPin = `${actualChecksum.slice(0, -1)}0`;
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      `${JSON.stringify({
        channelRuntime: {
          repo: 'rongxinzy/pi-connect',
          version: 'zhiyuan-sidecar-v4',
          sourceRevision: 'ecf720f875e31b3df3464d820e6c485775719abe',
          runtimeAssets: { 'linux-x64': 'sidecar-linux-x64.tgz' },
          runtimeChecksums: { 'linux-x64': wrongPin },
        },
      })}\n`,
    );

    expect(() => verifyPackagedChannelRuntime(linuxPackagingContext(projectRoot, appOutDir))).toThrow(
      'SHA-256 mismatch',
    );
  });

  test('rejects packaged channel runtime when package.json pin is missing', () => {
    const projectRoot = tempRoot();
    const appOutDir = path.join(projectRoot, 'out');
    writeChannelRuntimeFixture({
      projectRoot,
      appOutDir,
      sidecarBytes: Buffer.from('pinned sidecar'),
      pinTargetId: '',
    });
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      `${JSON.stringify({
        channelRuntime: {
          repo: 'rongxinzy/pi-connect',
          version: 'zhiyuan-sidecar-v4',
          sourceRevision: 'ecf720f875e31b3df3464d820e6c485775719abe',
          runtimeAssets: {},
          runtimeChecksums: {},
        },
      })}\n`,
    );

    expect(() => verifyPackagedChannelRuntime(linuxPackagingContext(projectRoot, appOutDir))).toThrow(
      'missing channelRuntime pin',
    );
  });

  test('rejects non-lite packaging when runtime-build-info.json is missing', () => {
    const projectRoot = tempRoot();
    const appOutDir = path.join(projectRoot, 'out');
    writeChannelRuntimeFixture({
      projectRoot,
      appOutDir,
      sidecarBytes: Buffer.from('pinned sidecar'),
      includeBuildInfo: false,
    });

    expect(() => verifyPackagedChannelRuntime(linuxPackagingContext(projectRoot, appOutDir))).toThrow(
      'runtime-build-info.json',
    );
  });

  test('rejects lite edition when llamacpp-bundled is present in packaged resources', () => {
    const projectRoot = tempRoot();
    const appOutDir = path.join(projectRoot, 'out');
    fs.mkdirSync(path.join(appOutDir, 'resources', 'llamacpp-bundled'), { recursive: true });
    process.env.ZHIYUAN_UPDATE_VARIANT = 'lite';

    expect(() =>
      verifyPackagedLlamaCppBundled(linuxPackagingContext(projectRoot, appOutDir)),
    ).toThrow('Lite edition must not include packaged llamacpp-bundled');
  });
});
