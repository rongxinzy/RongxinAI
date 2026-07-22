import { expect, test } from 'vitest';

import { MarketplaceCapability, type MarketplaceModel } from '../../../../shared/marketplace';
import type { InstallProgressState } from '../types';
import {
  capabilityLabel,
  getMarketplaceCapabilityTags,
  getMarketplaceDisplayName,
  getMarketplaceInstallProgress,
  getMarketplacePublisher,
  getMarketplaceRecommendedQuantization,
} from './marketplace';

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

test('formats a clean model name and finds the repository publisher', () => {
  expect(getMarketplaceDisplayName('unsloth/Qwen3.5-0.8B-GGUF')).toBe('Qwen3.5-0.8B');
  expect(getMarketplaceDisplayName('model.gguf')).toBe('model');
  expect(getMarketplacePublisher('unsloth/Qwen3.5-0.8B-GGUF')).toBe('unsloth');
  expect(getMarketplacePublisher('Qwen3.5-0.8B-GGUF')).toBeNull();
});

test('keeps only recognized capabilities and maps all detected tags', () => {
  const capabilities = getMarketplaceCapabilityTags({
    capability: MarketplaceCapability.Chat,
    tags: [
      MarketplaceCapability.Reasoning,
      MarketplaceCapability.Code,
      MarketplaceCapability.Vision,
      MarketplaceCapability.Embedding,
      'vendor-specific-tag',
    ],
  } as MarketplaceModel);

  expect(capabilities).toEqual([
    MarketplaceCapability.Chat,
    MarketplaceCapability.Reasoning,
    MarketplaceCapability.Code,
    MarketplaceCapability.Vision,
    MarketplaceCapability.Embedding,
  ]);
  expect(capabilityLabel(MarketplaceCapability.Reasoning)).toBe('推理');
});

test('omits a generic GGUF recommendation while preserving a concrete quantization', () => {
  expect(getMarketplaceRecommendedQuantization('GGUF')).toBeNull();
  expect(getMarketplaceRecommendedQuantization('')).toBeNull();
  expect(getMarketplaceRecommendedQuantization('Q4_K_M')).toBe('Q4_K_M');
});
