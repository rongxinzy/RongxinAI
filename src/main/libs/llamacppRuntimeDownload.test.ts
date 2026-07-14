import path from 'path';
import { describe, expect, test } from 'vitest';

const scriptPath = path.resolve(process.cwd(), 'scripts', 'download-llamacpp-runtime.cjs');
const {
  formatDownloadFailureMessage,
  resolveArchiveExtension,
  resolveRuntimeDownloadSource,
  resolveRuntimeDownloadSources,
  resolveRuntimeCompanionDownloadSources,
  resolveRuntimeReleaseTag,
} = require(scriptPath) as {
  resolveArchiveExtension: (archiveName: string) => string;
  formatDownloadFailureMessage: (
    status: number,
    statusText: string,
    url: string,
    targetId: string,
    rootDir: string,
  ) => string;
  resolveRuntimeDownloadSource: (
    targetId: string,
    options?: { env?: NodeJS.ProcessEnv; rootDir?: string },
  ) => string;
  resolveRuntimeDownloadSources: (
    targetId: string,
    options?: { env?: NodeJS.ProcessEnv; rootDir?: string },
  ) => string[];
  resolveRuntimeCompanionDownloadSources: (
    targetId: string,
    options?: { env?: NodeJS.ProcessEnv; rootDir?: string },
  ) => Array<{ assetName: string; urls: string[] }>;
  resolveRuntimeReleaseTag: (rootDir: string, env?: NodeJS.ProcessEnv) => string;
};

describe('llamacpp runtime download script', () => {
  test('defaults to the configured Cloudflare asset with GitHub fallback', () => {
    const rootDir = process.cwd();

    expect(resolveRuntimeReleaseTag(rootDir, {})).toBe('b9244');
    expect(resolveRuntimeDownloadSource('win-x64', { rootDir, env: {} })).toBe(
      'https://rongxinai.krli.org/llamacpp/b9244/llama-b9244-bin-win-cpu-x64.zip',
    );
    expect(resolveRuntimeDownloadSources('win-x64', { rootDir, env: {} })).toEqual([
      'https://rongxinai.krli.org/llamacpp/b9244/llama-b9244-bin-win-cpu-x64.zip',
      'https://github.com/ggml-org/llama.cpp/releases/download/b9244/llama-b9244-bin-win-cpu-x64.zip',
    ]);
    expect(resolveRuntimeDownloadSource('win-x64-cuda-12', { rootDir, env: {} })).toBe(
      'https://rongxinai.krli.org/llamacpp/b9244/llama-b9244-bin-win-cuda-12.4-x64.zip',
    );
    expect(resolveRuntimeCompanionDownloadSources('win-x64-cuda-12', { rootDir, env: {} })).toEqual([]);
  });

  test('supports zip and tar.gz runtime archives', () => {
    expect(resolveArchiveExtension('llama-b9244-bin-win-cpu-x64.zip')).toBe('.zip');
    expect(resolveArchiveExtension('llama-b9244-bin-ubuntu-x64.tar.gz')).toBe('.tar.gz');
  });

  test('maps the official asset names per target', () => {
    const rootDir = process.cwd();

    expect(resolveRuntimeReleaseTag(rootDir, { LLAMACPP_RUNTIME_RELEASE_TAG: 'b9243' })).toBe('b9243');
    expect(
      resolveRuntimeDownloadSource('linux-arm64', {
        rootDir,
        env: { LLAMACPP_RUNTIME_RELEASE_TAG: 'b9243' },
      }),
    ).toBe(
      'https://rongxinai.krli.org/llamacpp/b9243/llama-b9243-bin-ubuntu-arm64.tar.gz',
    );
  });

  test('allows explicit mirrors to substitute both target and asset placeholders', () => {
    const rootDir = process.cwd();
    const url = resolveRuntimeDownloadSource('mac-arm64', {
      rootDir,
      env: {
        LLAMACPP_RUNTIME_URL: 'https://mirror.example.com/{target}/{asset}',
      },
    });

    expect(url).toBe('https://mirror.example.com/mac-arm64/llama-b9244-bin-macos-arm64.tar.gz');
  });

  test('formats GitHub 404 failures with actionable guidance', () => {
    const rootDir = process.cwd();
    const url = 'https://github.com/ggml-org/llama.cpp/releases/download/b9244/llama-b9244-bin-win-cpu-x64.zip';

    const message = formatDownloadFailureMessage(404, 'Not Found', url, 'win-x64', rootDir);

    expect(message).toContain('does not exist');
    expect(message).toContain('published upstream llama.cpp asset');
    expect(message).toContain('llama-b9244-bin-win-cpu-x64.zip');
    expect(message).toContain('npm run llamacpp:runtime:win-x64');
  });
});
