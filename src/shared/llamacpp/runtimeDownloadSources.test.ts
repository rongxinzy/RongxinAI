import { describe, expect, test } from 'vitest';

import {
  DEFAULT_LLAMACPP_RUNTIME_RELEASES_URL,
  LLAMACPP_RUNTIME_ALLOW_GITHUB_FALLBACK_ENV,
  resolveLlamaCppRuntimeAssetDownloadUrls,
} from './runtimeDownloadSources';

describe('resolveLlamaCppRuntimeAssetDownloadUrls', () => {
  test('defaults to domestic mirror only', () => {
    expect(
      resolveLlamaCppRuntimeAssetDownloadUrls({
        targetId: 'win-x64',
        assetName: 'llama-b9244-bin-win-cpu-x64.zip',
        releaseTag: 'b9244',
        env: {},
      }),
    ).toEqual([`${DEFAULT_LLAMACPP_RUNTIME_RELEASES_URL}/b9244/llama-b9244-bin-win-cpu-x64.zip`]);
  });

  test('prefers official GitHub in CI with optional mirror fallback', () => {
    expect(
      resolveLlamaCppRuntimeAssetDownloadUrls({
        targetId: 'linux-x64',
        assetName: 'llama-b9244-bin-ubuntu-x64.tar.gz',
        releaseTag: 'b9244',
        env: { GITHUB_ACTIONS: 'true' },
      }),
    ).toEqual([
      'https://github.com/ggml-org/llama.cpp/releases/download/b9244/llama-b9244-bin-ubuntu-x64.tar.gz',
    ]);
    expect(
      resolveLlamaCppRuntimeAssetDownloadUrls({
        targetId: 'linux-x64',
        assetName: 'llama-b9244-bin-ubuntu-x64.tar.gz',
        releaseTag: 'b9244',
        env: { CI: 'true', LLAMACPP_RUNTIME_ALLOW_MIRROR_FALLBACK: '1' },
      }),
    ).toEqual([
      'https://github.com/ggml-org/llama.cpp/releases/download/b9244/llama-b9244-bin-ubuntu-x64.tar.gz',
      `${DEFAULT_LLAMACPP_RUNTIME_RELEASES_URL}/b9244/llama-b9244-bin-ubuntu-x64.tar.gz`,
    ]);
  });

  test('adds GitHub only when explicitly allowed', () => {
    expect(
      resolveLlamaCppRuntimeAssetDownloadUrls({
        targetId: 'win-x64',
        assetName: 'llama-b9244-bin-win-cpu-x64.zip',
        releaseTag: 'b9244',
        env: { [LLAMACPP_RUNTIME_ALLOW_GITHUB_FALLBACK_ENV]: '1' },
      }),
    ).toEqual([
      `${DEFAULT_LLAMACPP_RUNTIME_RELEASES_URL}/b9244/llama-b9244-bin-win-cpu-x64.zip`,
      'https://github.com/ggml-org/llama.cpp/releases/download/b9244/llama-b9244-bin-win-cpu-x64.zip',
    ]);
  });

  test('honors explicit runtime URL and base URL overrides', () => {
    expect(
      resolveLlamaCppRuntimeAssetDownloadUrls({
        targetId: 'mac-arm64',
        assetName: 'llama-b9244-bin-macos-arm64.tar.gz',
        releaseTag: 'b9244',
        env: { LLAMACPP_RUNTIME_URL: 'https://cdn.example/{target}/{asset}' },
      }),
    ).toEqual(['https://cdn.example/mac-arm64/llama-b9244-bin-macos-arm64.tar.gz']);

    expect(
      resolveLlamaCppRuntimeAssetDownloadUrls({
        targetId: 'linux-x64',
        assetName: 'llama-b9244-bin-ubuntu-x64.tar.gz',
        releaseTag: 'b9244',
        env: { LLAMACPP_RUNTIME_BASE_URL: 'https://mirror.example/llamacpp/b9244' },
      }),
    ).toEqual(['https://mirror.example/llamacpp/b9244/llama-b9244-bin-ubuntu-x64.tar.gz']);
  });
});
