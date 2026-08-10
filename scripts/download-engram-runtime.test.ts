import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { ensureMemoryRuntime, replaceDirectoryAtomically } =
  require('./download-engram-runtime.cjs') as {
    ensureMemoryRuntime: (
      rootDir: string,
      targetId: string,
      options: {
        config: RuntimeConfig;
        temporaryRoot: string;
        downloadRuntime: (url: string, destination: string) => Promise<void>;
        extractRuntime: (archive: string, destination: string) => Promise<void>;
      },
    ) => Promise<string>;
    replaceDirectoryAtomically: (
      stagedDirectory: string,
      targetDirectory: string,
      fileSystem?: Pick<typeof fs, 'existsSync' | 'renameSync' | 'rmSync'>,
    ) => void;
  };

interface RuntimeConfig {
  version: string;
  repo: string;
  runtimeAssets: Record<string, string>;
  runtimeChecksums: Record<string, string>;
}

const targetId = 'win-x64';
const executableName = 'engram.exe';
const archiveContent = 'verified archive';
const checksum = crypto.createHash('sha256').update(archiveContent).digest('hex');

describe('Engram runtime downloader', () => {
  let rootDir: string;
  let temporaryRoot: string;
  let config: RuntimeConfig;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-downloader-root-'));
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-downloader-temp-'));
    fs.mkdirSync(path.join(rootDir, 'third_party'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'third_party', 'engram.LICENSE'), 'license');
    config = {
      version: 'v1.20.0-zhiyuan.1',
      repo: 'z189yis/engram-cjk',
      runtimeAssets: { [targetId]: 'engram.zip' },
      runtimeChecksums: { [targetId]: checksum },
    };
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  function targetDirectory() {
    return path.join(rootDir, 'vendor', 'engram-runtime', targetId);
  }

  function writeCachedRuntime(buildInfo?: Record<string, string>) {
    fs.mkdirSync(targetDirectory(), { recursive: true });
    fs.writeFileSync(path.join(targetDirectory(), executableName), 'old runtime');
    if (buildInfo) {
      fs.writeFileSync(
        path.join(targetDirectory(), 'runtime-build-info.json'),
        JSON.stringify(buildInfo),
      );
    }
  }

  function options(downloadedContent = archiveContent) {
    return {
      config,
      temporaryRoot,
      downloadRuntime: async (_url: string, destination: string) => {
        fs.writeFileSync(destination, downloadedContent);
      },
      extractRuntime: async (_archive: string, destination: string) => {
        fs.writeFileSync(path.join(destination, executableName), 'new runtime');
      },
    };
  }

  test('replaces an executable whose build metadata is missing', async () => {
    writeCachedRuntime();

    await ensureMemoryRuntime(rootDir, targetId, options());

    expect(fs.readFileSync(path.join(targetDirectory(), executableName), 'utf8')).toBe(
      'new runtime',
    );
    const buildInfo = JSON.parse(
      fs.readFileSync(path.join(targetDirectory(), 'runtime-build-info.json'), 'utf8'),
    );
    expect(buildInfo.repo).toBe(config.repo);
  });

  test('replaces a cache created from a different repository', async () => {
    writeCachedRuntime({
      target: targetId,
      version: config.version,
      repo: 'Gentleman-Programming/engram',
      assetName: config.runtimeAssets[targetId],
      checksum,
    });

    await ensureMemoryRuntime(rootDir, targetId, options());

    expect(fs.readFileSync(path.join(targetDirectory(), executableName), 'utf8')).toBe(
      'new runtime',
    );
  });

  test('keeps the previous runtime when checksum verification fails', async () => {
    writeCachedRuntime();

    await expect(
      ensureMemoryRuntime(rootDir, targetId, options('corrupted archive')),
    ).rejects.toThrow('checksum mismatch');

    expect(fs.readFileSync(path.join(targetDirectory(), executableName), 'utf8')).toBe(
      'old runtime',
    );
  });

  test('reuses a cache only when all provenance fields match', async () => {
    writeCachedRuntime({
      target: targetId,
      version: config.version,
      repo: config.repo,
      assetName: config.runtimeAssets[targetId],
      checksum,
    });
    let downloadCount = 0;
    const validOptions = options();
    validOptions.downloadRuntime = async () => {
      downloadCount += 1;
    };

    await ensureMemoryRuntime(rootDir, targetId, validOptions);

    expect(downloadCount).toBe(0);
    expect(
      fs.readFileSync(
        path.join(rootDir, 'vendor', 'engram-runtime', 'current', executableName),
        'utf8',
      ),
    ).toBe('old runtime');
  });

  test('rejects placeholder checksums before downloading', async () => {
    config.runtimeChecksums[targetId] = 'PENDING';
    let downloadCount = 0;
    const pendingOptions = options();
    pendingOptions.downloadRuntime = async () => {
      downloadCount += 1;
    };

    await expect(ensureMemoryRuntime(rootDir, targetId, pendingOptions)).rejects.toThrow(
      'checksum is not finalized',
    );
    expect(downloadCount).toBe(0);
  });

  test('restores the previous runtime when the directory swap fails', () => {
    writeCachedRuntime();
    const stagedDirectory = path.join(rootDir, 'vendor', 'engram-runtime', '.staged-test');
    fs.mkdirSync(stagedDirectory, { recursive: true });
    fs.writeFileSync(path.join(stagedDirectory, executableName), 'new runtime');
    let renameCount = 0;
    const fileSystem = {
      existsSync: fs.existsSync,
      rmSync: fs.rmSync,
      renameSync(source: fs.PathLike, destination: fs.PathLike) {
        renameCount += 1;
        if (renameCount === 2) throw new Error('simulated swap failure');
        fs.renameSync(source, destination);
      },
    };

    expect(() =>
      replaceDirectoryAtomically(stagedDirectory, targetDirectory(), fileSystem),
    ).toThrow('simulated swap failure');
    expect(fs.readFileSync(path.join(targetDirectory(), executableName), 'utf8')).toBe(
      'old runtime',
    );
  });
});
