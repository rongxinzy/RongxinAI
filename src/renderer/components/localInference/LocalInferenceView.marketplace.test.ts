import { expect, test } from 'vitest';

test('marketplace page size is fixed across viewport sizes', async () => {
  const module = await import('./LocalInferenceView');
  const getMarketplacePageSize = (
    module as {
      __test__getMarketplacePageSize?: () => number;
    }
  ).__test__getMarketplacePageSize;

  expect(typeof getMarketplacePageSize).toBe('function');
  if (!getMarketplacePageSize) return;

  expect(getMarketplacePageSize()).toBe(6);
});

test('marketplace search params load directly up to the app and openapi caps', async () => {
  const module = await import('./LocalInferenceView');
  const buildMarketplaceSearchParams = (
    module as {
      __test__buildMarketplaceSearchParams?: (input: {
        query: string;
        pageNumber?: number;
      }) => { query?: string; limit?: number; pageNumber?: number } | null;
    }
  ).__test__buildMarketplaceSearchParams;

  expect(typeof buildMarketplaceSearchParams).toBe('function');
  if (!buildMarketplaceSearchParams) return;

  expect(buildMarketplaceSearchParams({ query: ' qwen ' })).toEqual({
    query: 'qwen',
    limit: 3000,
  });

  expect(
    buildMarketplaceSearchParams({
      query: ' qwen ',
      pageNumber: 4,
    }),
  ).toEqual({
    query: 'qwen',
    limit: 3000,
    pageNumber: 4,
  });

  expect(buildMarketplaceSearchParams({ query: '' })).toBeNull();
  expect(buildMarketplaceSearchParams({ query: ' / ' })).toBeNull();
});

test('marketplace only keeps installable models in the visible list', async () => {
  const module = await import('./LocalInferenceView');
  const getInstallableMarketplaceModels = (
    module as unknown as {
      __test__getInstallableMarketplaceModels?: (
        models: Array<{ id: string; repoId: string; installed: boolean; installedPath?: string }>,
        installedModelPathMap: Map<string, string>,
      ) => Array<{ id: string }>;
    }
  ).__test__getInstallableMarketplaceModels;

  expect(typeof getInstallableMarketplaceModels).toBe('function');
  if (!getInstallableMarketplaceModels) return;

  expect(
    getInstallableMarketplaceModels(
      [
        { id: 'a', repoId: 'Qwen/A-GGUF', installed: false },
        { id: 'b', repoId: 'Qwen/B-GGUF', installed: true },
        { id: 'c', repoId: 'Qwen/C-GGUF', installed: false, installedPath: '/models/Qwen/C.gguf' },
      ],
      new Map([['/models/Qwen/C.gguf', 'C']]),
    ).map(model => model.id),
  ).toEqual(['a']);
});

test('model card busy state locks the loading or unloading model card', async () => {
  const module = await import('./LocalInferenceView');
  const getModelCardBusyState = (
    module as {
      __test__getModelCardBusyState?: (input: {
        modelName: string;
        loadingModelName: string | null;
        unloadingModelName: string | null;
        globalLoading: boolean;
      }) => { cardBusy: boolean; buttonsDisabled: boolean };
    }
  ).__test__getModelCardBusyState;

  expect(typeof getModelCardBusyState).toBe('function');
  if (!getModelCardBusyState) return;

  expect(
    getModelCardBusyState({
      modelName: 'model-a',
      loadingModelName: null,
      unloadingModelName: 'model-a',
      globalLoading: false,
    }),
  ).toEqual({
    cardBusy: true,
    buttonsDisabled: true,
  });

  expect(
    getModelCardBusyState({
      modelName: 'model-b',
      loadingModelName: null,
      unloadingModelName: 'model-a',
      globalLoading: false,
    }),
  ).toEqual({
    cardBusy: false,
    buttonsDisabled: false,
  });

  expect(
    getModelCardBusyState({
      modelName: 'model-b',
      loadingModelName: null,
      unloadingModelName: null,
      globalLoading: true,
    }),
  ).toEqual({
    cardBusy: false,
    buttonsDisabled: true,
  });

  expect(
    getModelCardBusyState({
      modelName: 'model-a',
      loadingModelName: 'model-a',
      unloadingModelName: null,
      globalLoading: false,
    }),
  ).toEqual({
    cardBusy: true,
    buttonsDisabled: true,
  });

  expect(
    getModelCardBusyState({
      modelName: 'model-b',
      loadingModelName: 'model-a',
      unloadingModelName: null,
      globalLoading: false,
    }),
  ).toEqual({
    cardBusy: false,
    buttonsDisabled: true,
  });
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

test('local inference service action only auto-starts the shared llama.cpp service', async () => {
  const module = await import('./LocalInferenceView');
  const resolveLlamaCppServiceAction = (
    module as {
      __test__resolveLlamaCppServiceAction?: (
        snapshot: { status: string } | null | undefined,
      ) => string;
    }
  ).__test__resolveLlamaCppServiceAction;

  expect(typeof resolveLlamaCppServiceAction).toBe('function');
  if (!resolveLlamaCppServiceAction) return;

  expect(resolveLlamaCppServiceAction({ status: 'not-installed' })).toBe('install');
  expect(resolveLlamaCppServiceAction({ status: 'installed' })).toBe('start');
  expect(resolveLlamaCppServiceAction({ status: 'stopped' })).toBe('start');
  expect(resolveLlamaCppServiceAction({ status: 'running' })).toBe('ready');
  expect(resolveLlamaCppServiceAction({ status: 'error' })).toBe('refresh');
  expect(resolveLlamaCppServiceAction(null)).toBe('refresh');
});

test('local inference transient notices auto-dismiss within five seconds', async () => {
  const module = await import('./LocalInferenceView');
  const isInstallTerminalPhase = (
    module as {
      __test__isInstallTerminalPhase?: (phase: string) => boolean;
    }
  ).__test__isInstallTerminalPhase;
  const getLocalInferenceToastAutoDismissMs = (
    module as {
      __test__getLocalInferenceToastAutoDismissMs?: () => number;
    }
  ).__test__getLocalInferenceToastAutoDismissMs;
  const getLocalInferenceProgressDismissMs = (
    module as {
      __test__getLocalInferenceProgressDismissMs?: () => number;
    }
  ).__test__getLocalInferenceProgressDismissMs;

  expect(typeof isInstallTerminalPhase).toBe('function');
  expect(typeof getLocalInferenceToastAutoDismissMs).toBe('function');
  expect(typeof getLocalInferenceProgressDismissMs).toBe('function');
  if (
    !isInstallTerminalPhase ||
    !getLocalInferenceToastAutoDismissMs ||
    !getLocalInferenceProgressDismissMs
  ) {
    return;
  }

  expect(getLocalInferenceToastAutoDismissMs()).toBeLessThanOrEqual(5000);
  expect(getLocalInferenceProgressDismissMs()).toBeLessThanOrEqual(5000);
  expect(isInstallTerminalPhase('done')).toBe(true);
  expect(isInstallTerminalPhase('failed')).toBe(true);
  expect(isInstallTerminalPhase('cancelled')).toBe(true);
  expect(isInstallTerminalPhase('needs-manual')).toBe(true);
  expect(isInstallTerminalPhase('downloading-progress')).toBe(false);
});

test('install progress summary uses a readable separator', async () => {
  const module = await import('./LocalInferenceView');
  const formatInstallProgressSummary = (
    module as {
      __test__formatInstallProgressSummary?: (progress: Record<string, unknown>) => {
        primary: string;
        phase?: string;
        error?: string;
      };
    }
  ).__test__formatInstallProgressSummary;

  expect(typeof formatInstallProgressSummary).toBe('function');
  if (!formatInstallProgressSummary) return;

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
