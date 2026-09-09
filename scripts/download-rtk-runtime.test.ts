import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { ensureRtkRuntime, runtimeMatchesConfig } = require('./download-rtk-runtime.cjs') as {
  ensureRtkRuntime: (rootDir: string, targetId: string, options: RuntimeOptions) => Promise<string>;
  runtimeMatchesConfig: (
    buildInfo: Record<string, unknown>,
    config: RuntimeConfig,
    targetId: string,
    assetName: string,
    checksum: string,
  ) => boolean;
};

interface RuntimeConfig {
  version: string;
  repo: string;
  sourceRevision: string;
  runtimeAssets: Record<string, string>;
  runtimeChecksums: Record<string, string>;
}

interface RuntimeOptions {
  config: RuntimeConfig;
  temporaryRoot: string;
  downloadRuntime: (_url: string, destination: string) => Promise<void>;
  extractRuntime: (_archive: string, destination: string) => Promise<void>;
  verifyRuntime: (_executable: string, expectedVersion: string) => Promise<void>;
}

const targetId = 'win-x64';
const executableName = 'rtk.exe';
const archiveContent = 'verified archive';
const checksum = crypto.createHash('sha256').update(archiveContent).digest('hex');

describe('RTK runtime downloader', () => {
  let rootDir: string;
  let temporaryRoot: string;
  let config: RuntimeConfig;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-downloader-root-'));
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-downloader-temp-'));
    fs.mkdirSync(path.join(rootDir, 'third_party'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'third_party', 'rtk.LICENSE'), 'license');
    config = {
      version: 'v0.48.0',
      repo: 'rtk-ai/rtk',
      sourceRevision: 'fde0a8f185945556f51718de0f4c430bb62b3df6',
      runtimeAssets: { [targetId]: 'rtk.zip' },
      runtimeChecksums: { [targetId]: checksum },
    };
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  function targetDirectory() {
    return path.join(rootDir, 'vendor', 'rtk-runtime', targetId);
  }

  function options(content = archiveContent): RuntimeOptions {
    return {
      config,
      temporaryRoot,
      downloadRuntime: async (_url, destination) => {
        fs.writeFileSync(destination, content);
      },
      extractRuntime: async (_archive, destination) => {
        fs.writeFileSync(path.join(destination, executableName), 'new runtime');
      },
      verifyRuntime: async () => undefined,
    };
  }

  test('records immutable provenance and promotes the verified runtime', async () => {
    await ensureRtkRuntime(rootDir, targetId, options());

    const buildInfo = JSON.parse(
      fs.readFileSync(path.join(targetDirectory(), 'runtime-build-info.json'), 'utf8'),
    );
    expect(buildInfo).toMatchObject({
      schemaVersion: 1,
      target: targetId,
      repo: config.repo,
      version: config.version,
      sourceRevision: config.sourceRevision,
      checksum,
    });
    expect(
      fs.readFileSync(
        path.join(rootDir, 'vendor', 'rtk-runtime', 'current', executableName),
        'utf8',
      ),
    ).toBe('new runtime');
  });

  test('keeps the previous runtime when checksum verification fails', async () => {
    fs.mkdirSync(targetDirectory(), { recursive: true });
    fs.writeFileSync(path.join(targetDirectory(), executableName), 'old runtime');

    await expect(ensureRtkRuntime(rootDir, targetId, options('corrupted archive'))).rejects.toThrow(
      'checksum mismatch',
    );
    expect(fs.readFileSync(path.join(targetDirectory(), executableName), 'utf8')).toBe(
      'old runtime',
    );
  });

  test('reuses a cache only when the source revision is pinned', async () => {
    await ensureRtkRuntime(rootDir, targetId, options());
    let downloadCount = 0;
    const cachedOptions = options();
    cachedOptions.downloadRuntime = async () => {
      downloadCount += 1;
    };

    await ensureRtkRuntime(rootDir, targetId, cachedOptions);
    expect(downloadCount).toBe(0);

    const buildInfo = {
      schemaVersion: 1,
      target: targetId,
      version: config.version,
      repo: config.repo,
      sourceRevision: '0000000000000000000000000000000000000000',
      assetName: config.runtimeAssets[targetId],
      checksum,
    };
    expect(
      runtimeMatchesConfig(buildInfo, config, targetId, config.runtimeAssets[targetId], checksum),
    ).toBe(false);
  });

  test('rejects a placeholder checksum before downloading', async () => {
    config.runtimeChecksums[targetId] = 'PENDING';
    let downloadCount = 0;
    const pendingOptions = options();
    pendingOptions.downloadRuntime = async () => {
      downloadCount += 1;
    };

    await expect(ensureRtkRuntime(rootDir, targetId, pendingOptions)).rejects.toThrow(
      'checksum is not finalized',
    );
    expect(downloadCount).toBe(0);
  });
});
