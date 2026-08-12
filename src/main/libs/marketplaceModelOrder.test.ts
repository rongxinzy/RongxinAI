import { expect, test } from 'vitest';

import { MarketplaceSortOrder, type MarketplaceModel } from '../../shared/marketplace';
import { sortMarketplaceModels } from './marketplaceModelOrder';

function createModel(repoId: string, parameterCount: number, downloads: number): MarketplaceModel {
  return {
    source: 'modelscope-gguf',
    id: repoId,
    repoId,
    name: repoId,
    description: '',
    tags: ['chat'],
    sizes: [`${parameterCount / 1_000_000_000}B`],
    recommendedTag: 'Q4_K_M',
    capability: 'chat',
    parameterCount,
    downloads,
    installed: false,
  };
}

test('Marketplace model ordering prioritizes compact and dual 8GB-friendly models', () => {
  const models = [
    createModel('Qwen/20B-GGUF', 20_000_000_000, 1_000_000),
    createModel('Qwen/8B-GGUF', 8_000_000_000, 100),
    createModel('Qwen/4B-GGUF', 4_000_000_000, 100),
    createModel('Qwen/2B-GGUF', 2_000_000_000, 1),
    createModel('Qwen/32B-GGUF', 32_000_000_000, 2_000_000),
  ];

  expect(sortMarketplaceModels(models, {}).map(model => model.repoId)).toEqual([
    'Qwen/4B-GGUF',
    'Qwen/2B-GGUF',
    'Qwen/8B-GGUF',
    'Qwen/32B-GGUF',
    'Qwen/20B-GGUF',
  ]);
});

test('Marketplace model ordering sorts by parameter count ascending when requested', () => {
  const models = [
    createModel('Qwen/20B-GGUF', 20_000_000_000, 1),
    createModel('Qwen/2B-GGUF', 2_000_000_000, 1),
    createModel('Qwen/8B-GGUF', 8_000_000_000, 1),
  ];

  expect(sortMarketplaceModels(models, { sortby: MarketplaceSortOrder.Asc }).map(model => model.repoId)).toEqual([
    'Qwen/2B-GGUF',
    'Qwen/8B-GGUF',
    'Qwen/20B-GGUF',
  ]);
});

test('Marketplace model ordering sorts by parameter count descending when requested', () => {
  const models = [
    createModel('Qwen/2B-GGUF', 2_000_000_000, 1),
    createModel('Qwen/20B-GGUF', 20_000_000_000, 1),
    createModel('Qwen/8B-GGUF', 8_000_000_000, 1),
  ];

  expect(sortMarketplaceModels(models, { sortby: MarketplaceSortOrder.Desc }).map(model => model.repoId)).toEqual([
    'Qwen/20B-GGUF',
    'Qwen/8B-GGUF',
    'Qwen/2B-GGUF',
  ]);
});

test('Marketplace model ordering keeps fixed recommendations at the start of the default marketplace', () => {
  const fixedModel = {
    ...createModel('Qwen/8B-GGUF', 8_000_000_000, 1),
    featuredRank: 1,
  };
  const compactModel = createModel('Qwen/3B-GGUF', 3_000_000_000, 1_000_000);

  expect(sortMarketplaceModels([compactModel, fixedModel], {}).map(model => model.repoId)).toEqual([
    fixedModel.repoId,
    compactModel.repoId,
  ]);
  expect(
    sortMarketplaceModels([compactModel, fixedModel], { query: 'qwen' }).map(model => model.repoId),
  ).toEqual([compactModel.repoId, fixedModel.repoId]);
});
