import { expect, test } from 'vitest';
import {
  buildMarketplaceSearchParams,
  getInstallableMarketplaceModels,
  getMarketplaceGridColumnCount,
  getMarketplacePageSize,
} from './utils/marketplace';
import { LOCAL_INFERENCE_PROGRESS_DISMISS_MS, LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS } from './constants';
import { formatInstallProgressSummary, isInstallTerminalPhase } from './utils/progress';

test('marketplace page size uses the actual grid height', () => {
  expect(
    getMarketplacePageSize({
      availableGridHeight: 668,
      cardHeight: 124,
      columnCount: 4,
      rowGap: 12,
    }),
  ).toBe(20);
  expect(
    getMarketplacePageSize({
      availableGridHeight: 532,
      cardHeight: 124,
      columnCount: 4,
      rowGap: 12,
    }),
  ).toBe(16);
  expect(
    getMarketplacePageSize({
      availableGridHeight: 1_000,
      cardHeight: 124,
      columnCount: 4,
      rowGap: 12,
    }),
  ).toBe(20);
  expect(
    getMarketplacePageSize({
      availableGridHeight: 0,
      cardHeight: 124,
      columnCount: 4,
      rowGap: 12,
    }),
  ).toBe(8);
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
  expect(buildMarketplaceSearchParams({ query: ' qwen ' })).toEqual({
    query: 'qwen',
    limit: 300,
  });

  expect(buildMarketplaceSearchParams({ query: ' qwen ', pageNumber: 4 })).toEqual({
    query: 'qwen',
    limit: 300,
    pageNumber: 4,
  });

  expect(buildMarketplaceSearchParams({ query: '' })).toEqual({ limit: 24 });
  expect(buildMarketplaceSearchParams({ query: ' / ' })).toBeNull();
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