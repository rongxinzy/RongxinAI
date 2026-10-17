import { describe, expect, test } from 'vitest';

import {
  buildHfMirrorFileUrl,
  buildModelScopeFileUrl,
  convertModelScopeDownloadUrlToHfMirror,
  resolveGgufModelDownloadUrls,
} from './modelDownloadUrls';

describe('modelDownloadUrls', () => {
  test('builds ModelScope and hf-mirror URLs for the same repo revision and path', () => {
    expect(buildModelScopeFileUrl('Qwen/Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf', 'commit-sha')).toBe(
      'https://www.modelscope.cn/models/Qwen/Qwen3-8B-GGUF/resolve/commit-sha/Qwen3-8B-Q4_K_M.gguf',
    );
    expect(buildHfMirrorFileUrl('Qwen/Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf', 'commit-sha')).toBe(
      'https://hf-mirror.com/Qwen/Qwen3-8B-GGUF/resolve/commit-sha/Qwen3-8B-Q4_K_M.gguf',
    );
  });

  test('converts catalogue ModelScope URLs to hf-mirror', () => {
    const modelScope =
      'https://modelscope.cn/models/Qwen/Qwen3-8B-GGUF/resolve/commit-sha/Qwen3-8B-Q4_K_M.gguf';
    expect(convertModelScopeDownloadUrlToHfMirror(modelScope)).toBe(
      'https://hf-mirror.com/Qwen/Qwen3-8B-GGUF/resolve/commit-sha/Qwen3-8B-Q4_K_M.gguf',
    );
  });

  test('resolveGgufModelDownloadUrls prefers explicit URL then mirror', () => {
    expect(
      resolveGgufModelDownloadUrls({
        modelId: 'Qwen/Qwen3-8B-GGUF',
        filePath: 'Qwen3-8B-Q4_K_M.gguf',
        revision: 'commit-sha',
        downloadUrl:
          'https://www.modelscope.cn/models/Qwen/Qwen3-8B-GGUF/resolve/commit-sha/Qwen3-8B-Q4_K_M.gguf',
      }),
    ).toEqual([
      'https://www.modelscope.cn/models/Qwen/Qwen3-8B-GGUF/resolve/commit-sha/Qwen3-8B-Q4_K_M.gguf',
      'https://hf-mirror.com/Qwen/Qwen3-8B-GGUF/resolve/commit-sha/Qwen3-8B-Q4_K_M.gguf',
    ]);
  });

  test('resolveGgufModelDownloadUrls falls back to hf-mirror when no explicit URL', () => {
    expect(
      resolveGgufModelDownloadUrls({
        modelId: 'Qwen/Qwen3-8B-GGUF',
        filePath: 'Qwen3-8B-Q4_K_M.gguf',
        revision: 'commit-sha',
      }),
    ).toEqual([
      'https://www.modelscope.cn/models/Qwen/Qwen3-8B-GGUF/resolve/commit-sha/Qwen3-8B-Q4_K_M.gguf',
      'https://hf-mirror.com/Qwen/Qwen3-8B-GGUF/resolve/commit-sha/Qwen3-8B-Q4_K_M.gguf',
    ]);
  });
});
