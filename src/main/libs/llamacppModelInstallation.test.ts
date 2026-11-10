import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import type { LlamaCppInstallModelInput } from '../../shared/llamacpp';
import {
  collectSplitVariantFiles,
  installModelOnce,
  isSameInstallRequest,
  shardGroupKey,
} from './llamacppModelInstallation';
import type { MarketplaceModelFile } from '../../shared/marketplace';

test('an aborted response does not produce an unhandled stream cancellation', async () => {
  const modelsDir = mkdtempSync(path.join(tmpdir(), 'model-install-abort-'));
  const abort = new AbortController();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      abort.signal.addEventListener('abort', () => controller.error(abort.signal.reason));
    },
  });
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
  try {
    await expect(
      installModelOnce({
        request: {
          modelId: 'org/model',
          filePath: 'model.gguf',
          downloadUrl: 'https://www.modelscope.cn/model.gguf',
          sha256: 'a'.repeat(64),
        },
        modelsDir,
        safeModelDir: modelsDir,
        onProgress: progress => {
          if (progress.phase === 'downloading-progress') abort.abort();
        },
        options: { signal: abort.signal },
        refreshModelsAfterInstall: async () => {},
      }),
    ).rejects.toThrow('Install cancelled');
  } finally {
    fetch.mockRestore();
    rmSync(modelsDir, { recursive: true, force: true });
  }
});

const file = (
  path: string,
  overrides: Partial<MarketplaceModelFile> = {},
): MarketplaceModelFile => ({
  path,
  sizeBytes: 1_000,
  sha256: 'a'.repeat(64),
  downloadUrl: `https://example.com/${path}`,
  ...overrides,
});

describe('split-GGUF install metadata', () => {
  test('shardGroupKey strips the part suffix and keeps subdirectories', () => {
    expect(shardGroupKey('qwq-32b-fp16-00001-of-00017.gguf')).toBe('qwq-32b-fp16');
    expect(shardGroupKey('Q4_K_M/Model-Q4_K_M-00001-of-00004.gguf')).toBe('Q4_K_M/Model-Q4_K_M');
    expect(shardGroupKey('Model-Q4_K_M.gguf')).toBeNull();
  });

  test('collectSplitVariantFiles returns the sibling parts of a split variant', () => {
    const files = [
      file('qwq-32b-fp16-00001-of-00017.gguf'),
      file('qwq-32b-fp16-00002-of-00017.gguf'),
      file('qwq-32b-fp16-00003-of-00017.gguf'),
      file('mmproj-model-f16.gguf'),
    ];
    const extras = collectSplitVariantFiles(files, 'qwq-32b-fp16-00001-of-00017.gguf');
    expect(extras.map(extra => extra.path)).toEqual([
      'qwq-32b-fp16-00002-of-00017.gguf',
      'qwq-32b-fp16-00003-of-00017.gguf',
    ]);
    expect(extras[0]).toEqual(expect.objectContaining({ sha256: 'a'.repeat(64) }));
  });

  test('collectSplitVariantFiles is empty for standalone files and other groups', () => {
    const files = [
      file('Model-Q4_K_M.gguf'),
      file('Model-Q5_K_M.gguf'),
      file('BF16/Model-BF16-00001-of-00002.gguf'),
      file('BF16/Model-BF16-00002-of-00002.gguf'),
    ];
    expect(collectSplitVariantFiles(files, 'Model-Q4_K_M.gguf')).toEqual([]);
    expect(collectSplitVariantFiles(files, 'BF16/Model-BF16-00001-of-00002.gguf')).toEqual([
      expect.objectContaining({ path: 'BF16/Model-BF16-00002-of-00002.gguf' }),
    ]);
  });

  test('isSameInstallRequest distinguishes different split part sets', () => {
    const base: LlamaCppInstallModelInput = {
      modelId: 'org/model',
      filePath: 'model-00001-of-00002.gguf',
      downloadUrl: 'https://example.com/p1.gguf',
      sha256: 'a'.repeat(64),
    };
    const same = { ...base, extraFiles: [{ path: 'model-00002-of-00002.gguf' }] };
    const different = { ...base, extraFiles: [{ path: 'model-00002-of-00003.gguf' }] };
    expect(isSameInstallRequest(base, base)).toBe(true);
    expect(isSameInstallRequest(base, same)).toBe(false);
    expect(isSameInstallRequest(same, { ...same })).toBe(true);
    expect(isSameInstallRequest(same, different)).toBe(false);
  });
});
