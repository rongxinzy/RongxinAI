import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { downloadWithCurl, ensureChannelRuntime, readGitProxy, resolveDownloadProxy } =
  require('./download-channel-runtime.cjs') as {
    downloadWithCurl: (
      url: string,
      destination: string,
      proxy: string | null,
      runCommand: RunCommand,
    ) => void;
    ensureChannelRuntime: (
      rootDir: string,
      targetId: string,
      options: {
        config: RuntimeConfig;
        downloadRuntime: (url: string, destination: string) => Promise<void>;
      },
    ) => Promise<string>;
    readGitProxy: (url: string, runCommand: RunCommand) => string | null;
    resolveDownloadProxy: (
      url: string,
      options: { environment: Record<string, string | undefined>; runCommand: RunCommand },
    ) => string | null;
  };

type RunCommand = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => { status: number | null; stdout?: string; error?: Error };

interface RuntimeConfig {
  version: string;
  repo: string;
  sourceRevision: string;
  runtimeAssets: Record<string, string>;
  runtimeChecksums: Record<string, string>;
}

const targetId = 'win-x64';
const binaryName = 'cc-connect-sidecar.exe';
const binaryContent = 'verified sidecar';
const checksum = crypto.createHash('sha256').update(binaryContent).digest('hex');

describe('Channel runtime downloader', () => {
  let rootDir: string;
  let config: RuntimeConfig;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-runtime-root-'));
    config = {
      version: 'zhiyuan-sidecar-v1',
      repo: 'rongxinzy/pi-connect',
      sourceRevision: 'a'.repeat(40),
      runtimeAssets: { [targetId]: 'sidecar.exe' },
      runtimeChecksums: { [targetId]: checksum },
    };
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function targetDirectory() {
    return path.join(rootDir, 'vendor', 'channel-runtime', targetId);
  }

  function writeCachedRuntime(content: string, sourceRevision = config.sourceRevision) {
    fs.mkdirSync(targetDirectory(), { recursive: true });
    fs.writeFileSync(path.join(targetDirectory(), binaryName), content);
    fs.writeFileSync(
      path.join(targetDirectory(), 'runtime-build-info.json'),
      JSON.stringify({
        schemaVersion: 1,
        repo: config.repo,
        version: config.version,
        sourceRevision,
        target: targetId,
        assetName: config.runtimeAssets[targetId],
        checksum,
      }),
    );
  }

  test('downloads and records immutable provenance', async () => {
    await ensureChannelRuntime(rootDir, targetId, {
      config,
      downloadRuntime: async (_url, destination) => fs.writeFileSync(destination, binaryContent),
    });

    expect(fs.readFileSync(path.join(targetDirectory(), binaryName), 'utf8')).toBe(binaryContent);
    const buildInfo = JSON.parse(
      fs.readFileSync(path.join(targetDirectory(), 'runtime-build-info.json'), 'utf8'),
    );
    expect(buildInfo.sourceRevision).toBe(config.sourceRevision);
  });

  test('keeps the previous runtime when checksum verification fails', async () => {
    writeCachedRuntime('previous runtime');

    await expect(
      ensureChannelRuntime(rootDir, targetId, {
        config,
        downloadRuntime: async (_url, destination) => fs.writeFileSync(destination, 'tampered'),
      }),
    ).rejects.toThrow('checksum mismatch');

    expect(fs.readFileSync(path.join(targetDirectory(), binaryName), 'utf8')).toBe(
      'previous runtime',
    );
  });

  test('reuses a cache only when its binary and provenance both match', async () => {
    writeCachedRuntime(binaryContent);
    let downloadCount = 0;

    await ensureChannelRuntime(rootDir, targetId, {
      config,
      downloadRuntime: async () => {
        downloadCount += 1;
      },
    });

    expect(downloadCount).toBe(0);
    expect(
      fs.readFileSync(
        path.join(rootDir, 'vendor', 'channel-runtime', 'current', binaryName),
        'utf8',
      ),
    ).toBe(binaryContent);
  });

  test('redownloads a cache built from a different source revision', async () => {
    writeCachedRuntime(binaryContent, 'b'.repeat(40));
    let downloadCount = 0;

    await ensureChannelRuntime(rootDir, targetId, {
      config,
      downloadRuntime: async (_url, destination) => {
        downloadCount += 1;
        fs.writeFileSync(destination, binaryContent);
      },
    });

    expect(downloadCount).toBe(1);
  });

  test('rejects a placeholder checksum before downloading', async () => {
    config.runtimeChecksums[targetId] = 'PENDING_RELEASE_CHECKSUM';
    let downloadCount = 0;

    await expect(
      ensureChannelRuntime(rootDir, targetId, {
        config,
        downloadRuntime: async () => {
          downloadCount += 1;
        },
      }),
    ).rejects.toThrow('checksum is not finalized');
    expect(downloadCount).toBe(0);
  });

  test('prefers an environment proxy without consulting Git', () => {
    let gitCallCount = 0;
    const proxy = resolveDownloadProxy('https://github.com/example/runtime', {
      environment: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      runCommand: () => {
        gitCallCount += 1;
        return { status: 1 };
      },
    });

    expect(proxy).toBe('http://127.0.0.1:7890');
    expect(gitCallCount).toBe(0);
  });

  test('uses the URL-matched Git proxy when the environment has none', () => {
    let invocation: { command: string; args: string[] } | undefined;
    const proxy = readGitProxy('https://github.com/example/runtime', (command, args) => {
      invocation = { command, args };
      return { status: 0, stdout: 'http://127.0.0.1:7897\n' };
    });

    expect(proxy).toBe('http://127.0.0.1:7897');
    expect(invocation).toEqual({
      command: 'git',
      args: ['config', '--get-urlmatch', 'http.proxy', 'https://github.com/example/runtime'],
    });
  });

  test('passes retry and proxy options to curl', () => {
    let invocation: { command: string; args: string[] } | undefined;
    downloadWithCurl(
      'https://github.com/example/runtime',
      'runtime.bin',
      'http://127.0.0.1:7890',
      (command, args) => {
        invocation = { command, args };
        return { status: 0 };
      },
    );

    expect(invocation?.command).toBe('curl');
    expect(invocation?.args).toContain('--retry-all-errors');
    expect(invocation?.args).toContain('http://127.0.0.1:7890');
  });
});
