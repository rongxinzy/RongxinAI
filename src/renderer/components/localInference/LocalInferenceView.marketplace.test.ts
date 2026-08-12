import { expect, test } from 'vitest';

import { MarketplaceDeviceProfile } from '../../../shared/marketplace';
import {
  buildMarketplaceSearchParams,
  filterMarketplaceModelsForDevice,
  getInstallableMarketplaceModels,
  getMarketplaceGridColumnCount,
  getMarketplacePageSize,
} from './utils/marketplace';
import { LOCAL_INFERENCE_PROGRESS_DISMISS_MS, LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS, MARKETPLACE_MAX_PAGE_ROWS, MARKETPLACE_PAGE_SIZE } from './constants';
import { formatInstallProgressSummary, isInstallTerminalPhase } from './utils/progress';

test('marketplace page size uses the actual grid height', () => {
  expect(
    getMarketplacePageSize({
      availableGridHeight: 668,
      cardHeight: 124,
      columnCount: 4,
      rowGap: 12,
    }),
  ).toBe(MARKETPLACE_MAX_PAGE_ROWS * 4);
  expect(
    getMarketplacePageSize({
      availableGridHeight: 532,
      cardHeight: 124,
      columnCount: 4,
      rowGap: 12,
    }),
  ).toBe(MARKETPLACE_MAX_PAGE_ROWS * 4);
  expect(
    getMarketplacePageSize({
      availableGridHeight: 1_000,
      cardHeight: 124,
      columnCount: 4,
      rowGap: 12,
    }),
  ).toBe(MARKETPLACE_MAX_PAGE_ROWS * 4);
  expect(
    getMarketplacePageSize({
      availableGridHeight: 0,
      cardHeight: 124,
      columnCount: 4,
      rowGap: 12,
    }),
  ).toBe(MARKETPLACE_PAGE_SIZE);
});

test('marketplace page size remains a whole number of grid rows', () => {
  const pageSize = getMarketplacePageSize({
    availableGridHeight: 668,
    cardHeight: 124,
    columnCount: 4,
    rowGap: 12,
  });

  expect(pageSize % 4).toBe(0);
});

test('grid column count uses track geometry when the last page has a partial row', () => {
  expect(
    getMarketplaceGridColumnCount({
      gridWidth: 1_000,
      cardWidth: 238,
      columnGap: 16,
    }),
  ).toBe(4);
  expect(
    getMarketplaceGridColumnCount({
      gridWidth: 680,
      cardWidth: 332,
      columnGap: 16,
    }),
  ).toBe(2);
});

test('marketplace search params load recommended models for an empty query and use the app cap for a search', () => {
  expect(buildMarketplaceSearchParams({ query: ' qwen ' })).toMatchObject({
    query: 'qwen',
    limit: MARKETPLACE_PAGE_SIZE,
  });

  expect(buildMarketplaceSearchParams({ query: ' qwen ', pageNumber: 4 })).toMatchObject({
    query: 'qwen',
    limit: MARKETPLACE_PAGE_SIZE,
    pageNumber: 4,
  });

  expect(buildMarketplaceSearchParams({ query: '' })).toMatchObject({
    limit: MARKETPLACE_PAGE_SIZE,
    featuredOnly: false,
  });
  expect(buildMarketplaceSearchParams({ query: ' / ' })).toBeNull();
});

test('marketplace search params honour a caller-supplied page size', () => {
  expect(buildMarketplaceSearchParams({ query: 'qwen', limit: 12 })).toMatchObject({
    query: 'qwen',
    limit: 12,
  });
  expect(buildMarketplaceSearchParams({ query: '', limit: 16 })).toMatchObject({
    limit: 16,
    featuredOnly: false,
  });
});

test('marketplace browse modes carry their result context into server pagination', () => {
  expect(buildMarketplaceSearchParams({ query: '', pageNumber: 3, featuredOnly: false })).toMatchObject({
    limit: MARKETPLACE_PAGE_SIZE,
    pageNumber: 3,
    featuredOnly: false,
  });
  expect(buildMarketplaceSearchParams({ query: '', task: 'chat', pageNumber: 2, featuredOnly: false })).toMatchObject({
    limit: MARKETPLACE_PAGE_SIZE,
    pageNumber: 2,
    task: 'chat',
    featuredOnly: false,
  });
  expect(buildMarketplaceSearchParams({ query: 'qwen', pageNumber: 2, task: 'code' })).toMatchObject({
    query: 'qwen',
    limit: MARKETPLACE_PAGE_SIZE,
    pageNumber: 2,
    task: 'code',
  });
});

test('marketplace search params preserve the selected device profile', () => {
  expect(
    buildMarketplaceSearchParams({
      query: 'qwen',
      device: MarketplaceDeviceProfile.Pro,
      pageNumber: 2,
    }),
  ).toMatchObject({
    query: 'qwen',
    device: MarketplaceDeviceProfile.Pro,
    pageNumber: 2,
  });
});

test('marketplace only keeps installable models in the visible list', () => {
  expect(
    getInstallableMarketplaceModels(
      [
        { source: 'modelscope-gguf', id: 'a', repoId: 'Qwen/A-GGUF', name: 'A', description: '', tags: [], sizes: [], recommendedTag: '', capability: 'chat', installed: false },
        { source: 'modelscope-gguf', id: 'b', repoId: 'Qwen/B-GGUF', name: 'B', description: '', tags: [], sizes: [], recommendedTag: '', capability: 'chat', installed: true },
        { source: 'modelscope-gguf', id: 'c', repoId: 'Qwen/C-GGUF', name: 'C', description: '', tags: [], sizes: [], recommendedTag: '', capability: 'chat', installed: false, installedPath: '/models/Qwen/C.gguf' },
        { source: 'modelscope-gguf', id: 'duplicate-a', repoId: 'Qwen/A-GGUF', name: 'A duplicate', description: '', tags: [], sizes: [], recommendedTag: '', capability: 'chat', installed: false },
      ],
      new Map([['/models/Qwen/C.gguf', 'C']]),
    ).map(model => model.id),
  ).toEqual(['a']);
});

test('device-fit filters are applied locally after scoring', () => {
  const models = [
    { source: 'modelscope-gguf', id: 'excellent', repoId: 'Qwen/Excellent-GGUF', name: 'Excellent', description: '', tags: [], sizes: [], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, fit: { status: 'excellent' }, score: { stars: 4.8 } },
    { source: 'modelscope-gguf', id: 'limited', repoId: 'Qwen/Limited-GGUF', name: 'Limited', description: '', tags: [], sizes: [], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, fit: { status: 'limited' }, score: { stars: 4.2 } },
    { source: 'modelscope-gguf', id: 'unsupported', repoId: 'Qwen/Unsupported-GGUF', name: 'Unsupported', description: '', tags: [], sizes: [], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, fit: { status: 'unsupported' }, score: { stars: 3.8 } },
  ] as never[];

  expect(filterMarketplaceModelsForDevice(models, 'recommended').map(model => model.id)).toEqual([
    'excellent',
    'limited',
  ]);
  expect(filterMarketplaceModelsForDevice(models, 'compatible').map(model => model.id)).toEqual([
    'excellent',
    'limited',
  ]);
  expect(filterMarketplaceModelsForDevice(models, 'all', 4.5).map(model => model.id)).toEqual([
    'excellent',
  ]);
});

test('models the current device cannot run are only shown when fit is unrestricted', () => {
  const models = [
    { source: 'modelscope-gguf', id: 'excellent', repoId: 'Qwen/Excellent-GGUF', name: 'Excellent', description: '', tags: [], sizes: [], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, fit: { status: 'excellent' }, score: { stars: 4.8 } },
    { source: 'modelscope-gguf', id: 'limited', repoId: 'Qwen/Limited-GGUF', name: 'Limited', description: '', tags: [], sizes: [], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, fit: { status: 'limited' }, score: { stars: 4.2 } },
    { source: 'modelscope-gguf', id: 'unsupported', repoId: 'Qwen/Unsupported-GGUF', name: 'Unsupported', description: '', tags: [], sizes: [], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, fit: { status: 'unsupported' }, score: { stars: 3.8 } },
    { source: 'modelscope-gguf', id: 'unknown', repoId: 'Qwen/Unknown-GGUF', name: 'Unknown', description: '', tags: [], sizes: [], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, fit: { status: 'unknown' }, score: { stars: 4.0 } },
  ] as never[];

  // "不限" lists every GGUF model, unsupported included — the card flags them
  // as not fitting. The explicit unsupported filter and the default tiers
  // still hide them; unknown (hardware not detected) stays visible everywhere.
  expect(filterMarketplaceModelsForDevice(models, 'all').map(model => model.id)).toEqual([
    'excellent',
    'limited',
    'unsupported',
    'unknown',
  ]);
  expect(filterMarketplaceModelsForDevice(models, 'unsupported').map(model => model.id)).toEqual([]);
  expect(filterMarketplaceModelsForDevice(models, 'compatible').map(model => model.id)).toEqual([
    'excellent',
    'limited',
    'unknown',
  ]);
});

test('model action guard blocks operations for the unloading model only', async () => {
  const module = await import('./LocalInferenceView');
  const shouldBlockModelAction = (
    module as {
      __test__shouldBlockModelAction?: (input: {
        modelName: string;
        unloadingModelName: string | null;
      }) => boolean;
    }
  ).__test__shouldBlockModelAction;

  expect(typeof shouldBlockModelAction).toBe('function');
  if (!shouldBlockModelAction) return;

  expect(
    shouldBlockModelAction({
      modelName: 'model-a',
      unloadingModelName: 'model-a',
    }),
  ).toBe(true);

  expect(
    shouldBlockModelAction({
      modelName: 'model-b',
      unloadingModelName: 'model-a',
    }),
  ).toBe(false);

  expect(
    shouldBlockModelAction({
      modelName: 'model-a',
      unloadingModelName: null,
    }),
  ).toBe(false);
});

test('unload busy state keeps a minimum visible duration', async () => {
  const module = await import('./LocalInferenceView');
  const getRemainingBusyMs = (
    module as {
      __test__getRemainingBusyMs?: (input: {
        startedAtMs: number;
        nowMs: number;
        minimumBusyMs: number;
      }) => number;
    }
  ).__test__getRemainingBusyMs;

  expect(typeof getRemainingBusyMs).toBe('function');
  if (!getRemainingBusyMs) return;

  expect(
    getRemainingBusyMs({
      startedAtMs: 100,
      nowMs: 250,
      minimumBusyMs: 500,
    }),
  ).toBe(350);

  expect(
    getRemainingBusyMs({
      startedAtMs: 100,
      nowMs: 700,
      minimumBusyMs: 500,
    }),
  ).toBe(0);
});

test('local inference transient notices auto-dismiss within five seconds', () => {
  expect(LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS).toBeLessThanOrEqual(5000);
  expect(LOCAL_INFERENCE_PROGRESS_DISMISS_MS).toBeLessThanOrEqual(5000);
  expect(isInstallTerminalPhase('done')).toBe(true);
  expect(isInstallTerminalPhase('failed')).toBe(true);
  expect(isInstallTerminalPhase('cancelled')).toBe(true);
  expect(isInstallTerminalPhase('needs-manual')).toBe(true);
  expect(isInstallTerminalPhase('downloading-progress')).toBe(false);
});

test('install progress summary uses a readable separator', () => {
  expect(
    formatInstallProgressSummary({
      status: 'downloading',
      completed: 1024,
      total: 2048,
      percent: 50,
      speed: 512,
    }).primary,
  ).toContain(' | ');
});
