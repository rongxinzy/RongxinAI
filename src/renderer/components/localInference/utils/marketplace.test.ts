import { expect, test } from 'vitest';

import { MarketplaceCapability, type MarketplaceModel, type MarketplaceModelFile } from '../../../../shared/marketplace';
import {
  MARKETPLACE_INITIAL_MODEL_COUNT,
  MARKETPLACE_MAX_PAGE_ROWS,
  MARKETPLACE_PAGE_SIZE,
} from '../constants';
import type { InstallProgressState } from '../types';
import {
  buildMarketplaceSearchParams,
  capabilityLabel,
  filterMarketplaceModelsForDevice,
  filterMarketplaceModelsForRecommendation,
  getInstallableMarketplaceModels,
  getMarketplaceCapabilityTags,
  getMarketplaceDisplayName,
  getMarketplaceGridColumnCount,
  getMarketplaceInstallProgress,
  getMarketplacePageSize,
  getMarketplacePublisher,
  getMarketplaceRecommendedQuantization,
  groupMarketplaceVariants,
  sortMarketplaceModelsForRecommendation,
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

test('recommendations prioritize runnable models and then score', () => {
  const models = [
    { id: 'limited-high', repoId: 'Qwen/Limited-High', fit: { status: 'limited' }, score: { value: 99 } },
    { id: 'good-low', repoId: 'Qwen/Good-Low', fit: { status: 'good' }, score: { value: 60 } },
    { id: 'excellent-high', repoId: 'Qwen/Excellent-High', fit: { status: 'excellent' }, score: { value: 88 } },
    { id: 'excellent-low', repoId: 'Qwen/Excellent-Low', fit: { status: 'excellent' }, score: { value: 72 } },
  ] as unknown as MarketplaceModel[];

  expect(sortMarketplaceModelsForRecommendation(models).map(model => model.id)).toEqual([
    'excellent-high',
    'excellent-low',
    'good-low',
    'limited-high',
  ]);
  expect(filterMarketplaceModelsForRecommendation(models).map(model => model.id)).toEqual([
    'limited-high',
    'good-low',
    'excellent-high',
    'excellent-low',
  ]);
});
test('filters models by device fit, restricting the default but opening up with "不限"', () => {
  const model = (status: string, stars = 4) =>
    ({ id: status, repoId: status, fit: { status }, score: { stars } }) as unknown as MarketplaceModel;
  const models = [
    model('excellent'),
    model('good'),
    model('limited'),
    model('unknown'),
    model('unsupported'),
  ];

  // The default "可运行" and stricter tiers never show unsupported models.
  expect(filterMarketplaceModelsForDevice(models, 'recommended').map(m => m.id)).toEqual([
    'excellent',
    'good',
    'limited',
  ]);
  expect(filterMarketplaceModelsForDevice(models, 'compatible').map(m => m.id)).toEqual([
    'excellent',
    'good',
    'limited',
    'unknown',
  ]);
  expect(filterMarketplaceModelsForDevice(models, 'excellent').map(m => m.id)).toEqual(['excellent']);
  expect(filterMarketplaceModelsForDevice(models, 'unsupported').map(m => m.id)).toEqual([]);

  // "不限" (all) lists every GGUF model, including ones this device cannot run.
  expect(filterMarketplaceModelsForDevice(models, 'all').map(m => m.id)).toEqual([
    'excellent',
    'good',
    'limited',
    'unknown',
    'unsupported',
  ]);
});

test('fit=all keeps unsupported GGUF models visible in the grid', () => {
  // The reported regression: choosing the unrestricted fit ("不限") collapsed
  // to zero cards when every match was unsupported for this device. The
  // unrestricted filter must list the models, not silently drop them.
  const models = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name =>
    ({ id: name, repoId: name, fit: { status: 'unsupported' }, score: { stars: 3 } }) as unknown as MarketplaceModel,
  );

  expect(filterMarketplaceModelsForDevice(models, 'all')).toHaveLength(7);
  expect(filterMarketplaceModelsForDevice(models, 'recommended')).toHaveLength(0);
});

test('excludes duplicates and installed models from the installable set', () => {
  const installedPathMap = new Map([['/models/beta.gguf', 'beta']]);
  const models = [
    { id: 'a', repoId: 'org/a', installed: false },
    { id: 'a', repoId: 'org/a', installed: false },
    { id: 'b', repoId: 'org/b', installed: true },
    { id: 'c', repoId: 'org/c', installed: false, installedPath: '/models/beta.gguf' },
  ] as unknown as MarketplaceModel[];

  const result = getInstallableMarketplaceModels(models, installedPathMap);
  expect(result.map(m => m.id)).toEqual(['a']);
});

test('empty query browses all models by default', () => {
  const params = buildMarketplaceSearchParams({ query: '   ' });
  expect(params).not.toBeNull();
  expect(params).toEqual({
    limit: MARKETPLACE_INITIAL_MODEL_COUNT,
    pageNumber: undefined,
    sortby: 'asc',
    featuredOnly: false,
    task: undefined,
    size: undefined,
    fit: 'all',
    minStars: undefined,
  });
});

test('empty query task categories browse the full catalogue', () => {
  const params = buildMarketplaceSearchParams({ query: '   ', task: 'vision' });
  expect(params).toMatchObject({
    task: 'vision',
    featuredOnly: false,
  });
});

test('rejects queries without any letter or digit', () => {
  expect(buildMarketplaceSearchParams({ query: '!!!' })).toBeNull();
  expect(buildMarketplaceSearchParams({ query: 'qwen3' })).not.toBeNull();
});

test('page size fits whole rows into the available grid height', () => {
  // Invalid geometry falls back to the default page size.
  expect(getMarketplacePageSize({ availableGridHeight: 0, cardHeight: 200, columnCount: 3, rowGap: 16 })).toBe(
    MARKETPLACE_PAGE_SIZE,
  );
  expect(getMarketplacePageSize({ availableGridHeight: 100, cardHeight: 0, columnCount: 3, rowGap: 16 })).toBe(
    MARKETPLACE_PAGE_SIZE,
  );

  // 3 rows × 3 columns = 9 cards.
  expect(
    getMarketplacePageSize({ availableGridHeight: 648, cardHeight: 200, columnCount: 3, rowGap: 16 }),
  ).toBe(9);

  // The row cap is MARKETPLACE_MAX_PAGE_ROWS even when the viewport is tall.
  expect(
    getMarketplacePageSize({ availableGridHeight: 5000, cardHeight: 200, columnCount: 4, rowGap: 16 }),
  ).toBe(MARKETPLACE_MAX_PAGE_ROWS * 4);
});

test('grid column count derives from measured card width', () => {
  expect(getMarketplaceGridColumnCount({ gridWidth: 0, cardWidth: 380, columnGap: 16 })).toBe(1);
  expect(getMarketplaceGridColumnCount({ gridWidth: 1200, cardWidth: 380, columnGap: 16 })).toBe(3);
  expect(getMarketplaceGridColumnCount({ gridWidth: 800, cardWidth: 380, columnGap: 16 })).toBe(2);
});

const file = (path: string, sizeBytes = 1_000, overrides: Partial<MarketplaceModelFile> = {}): MarketplaceModelFile => ({
  path,
  sizeBytes,
  sha256: 'a'.repeat(64),
  downloadUrl: `https://example.com/${path}`,
  ...overrides,
});

test('groups standalone files into one variant each', () => {
  const variants = groupMarketplaceVariants([
    file('Model-Q4_K_M.gguf', 4_000),
    file('Model-Q5_K_M.gguf', 5_000),
  ]);
  expect(variants).toHaveLength(2);
  expect(variants[0].files.map(f => f.path)).toEqual(['Model-Q4_K_M.gguf']);
  expect(variants[0].isSplit).toBe(false);
});

test('collapses split-GGUF parts into a single variant and flags it', () => {
  const variants = groupMarketplaceVariants([
    file('BF16/Model-BF16-00001-of-00002.gguf', 47_000),
    file('BF16/Model-BF16-00002-of-00002.gguf', 48_000),
    file('Q4_K_M/Model-Q4_K_M-00001-of-00004.gguf', 49_000, { isRecommended: true }),
    file('Q4_K_M/Model-Q4_K_M-00002-of-00004.gguf', 49_000),
  ]);
  const split = variants.filter(variant => variant.isSplit);
  expect(split).toHaveLength(2);
  const recommended = variants.find(variant => variant.isRecommended);
  expect(recommended?.quantization).toBe('Q4_K_M');
  expect(recommended?.files).toHaveLength(2);
  expect(recommended?.totalSizeBytes).toBe(98_000);
});

test('recommends the preferred quantization group first', () => {
  const variants = groupMarketplaceVariants([
    file('BF16/Model-BF16-00001-of-00002.gguf', 47_000),
    file('BF16/Model-BF16-00002-of-00002.gguf', 48_000),
    file('Q4_K_M/Model-Q4_K_M-00001-of-00004.gguf', 49_000),
    file('Q4_K_M/Model-Q4_K_M-00002-of-00004.gguf', 49_000),
  ]);
  expect(variants[0].quantization).toBe('Q4_K_M');
  expect(variants[0].isSplit).toBe(true);
});

test('a split-only repo (e.g. QwQ-32B) still yields an installable variant', () => {
  const variants = groupMarketplaceVariants([
    file('qwq-32b-fp16-00001-of-00017.gguf', 3_900),
    file('qwq-32b-fp16-00002-of-00017.gguf', 3_900),
  ]);
  expect(variants).toHaveLength(1);
  expect(variants[0].isSplit).toBe(true);
  expect(variants[0].files).toHaveLength(2);
});

test('excludes mmproj files from variants', () => {
  const variants = groupMarketplaceVariants([
    file('mmproj-model-f16.gguf', 1_400),
    file('Model-Q4_K_M.gguf', 4_000),
  ]);
  expect(variants).toHaveLength(1);
  expect(variants[0].files[0].path).toBe('Model-Q4_K_M.gguf');
});
