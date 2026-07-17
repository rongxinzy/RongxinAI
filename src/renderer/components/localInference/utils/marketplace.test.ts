import { expect, test } from 'vitest';

import type { InstallProgressState } from '../types';
import { getMarketplaceInstallProgress } from './marketplace';

test('finds marketplace download progress by repository id', () => {
  const progress: InstallProgressState = {
    'Qwen/Qwen3-0.6B-GGUF': {
      phase: 'downloading',
      percent: 25,
      modelId: 'Qwen/Qwen3-0.6B-GGUF',
      modelName: 'Qwen3',
    },
  };

  expect(
    getMarketplaceInstallProgress(progress, {
      id: 'modelscope-qwen3',
      repoId: 'Qwen/Qwen3-0.6B-GGUF',
    }),
  ).toBe(progress['Qwen/Qwen3-0.6B-GGUF']);
});

test('falls back to the marketplace model id for progress events from alternate sources', () => {
  const progress: InstallProgressState = {
    'modelscope-qwen3': {
      phase: 'downloading',
      percent: 25,
      modelId: 'modelscope-qwen3',
      modelName: 'Qwen3',
    },
  };

  expect(
    getMarketplaceInstallProgress(progress, {
      id: 'modelscope-qwen3',
      repoId: 'Qwen/Qwen3-0.6B-GGUF',
    }),
  ).toBe(progress['modelscope-qwen3']);
});
