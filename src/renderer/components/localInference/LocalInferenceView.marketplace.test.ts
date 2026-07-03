import { expect, test } from 'vitest';

test('marketplace page size is fixed across viewport sizes', async () => {
  const module = await import('./LocalInferenceView');
  const getMarketplacePageSize = (module as {
    __test__getMarketplacePageSize?: () => number;
  }).__test__getMarketplacePageSize;

  expect(typeof getMarketplacePageSize).toBe('function');
  if (!getMarketplacePageSize) return;

  expect(getMarketplacePageSize()).toBe(6);
});

test('marketplace search params load directly up to the app and openapi caps', async () => {
  const module = await import('./LocalInferenceView');
  const buildMarketplaceSearchParams = (module as {
    __test__buildMarketplaceSearchParams?: (input: {
      query: string;
      pageNumber?: number;
    }) => { query?: string; limit?: number; pageNumber?: number } | null;
  }).__test__buildMarketplaceSearchParams;

  expect(typeof buildMarketplaceSearchParams).toBe('function');
  if (!buildMarketplaceSearchParams) return;

  expect(buildMarketplaceSearchParams({ query: ' qwen ' })).toEqual({
    query: 'qwen',
    limit: 3000,
  });

  expect(buildMarketplaceSearchParams({
    query: ' qwen ',
    pageNumber: 4,
  })).toEqual({
    query: 'qwen',
    limit: 3000,
    pageNumber: 4,
  });

  expect(buildMarketplaceSearchParams({ query: '' })).toBeNull();
  expect(buildMarketplaceSearchParams({ query: ' / ' })).toBeNull();
});

test('marketplace only keeps installable models in the visible list', async () => {
  const module = await import('./LocalInferenceView');
  const getInstallableMarketplaceModels = (module as unknown as {
    __test__getInstallableMarketplaceModels?: (
      models: Array<{ id: string; repoId: string; installed: boolean; installedPath?: string }>,
      installedModelPathMap: Map<string, string>,
    ) => Array<{ id: string }>;
  }).__test__getInstallableMarketplaceModels;

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

test('modelscope manual install requires owner repo id', async () => {
  const module = await import('./LocalInferenceView');
  const isModelScopeRepoId = (module as {
    __test__isModelScopeRepoId?: (value: string) => boolean;
  }).__test__isModelScopeRepoId;

  expect(typeof isModelScopeRepoId).toBe('function');
  if (!isModelScopeRepoId) return;

  expect(isModelScopeRepoId('Qwen/Qwen3-8B-GGUF')).toBe(true);
  expect(isModelScopeRepoId('  unsloth/Qwen3.5-0.8B-GGUF  ')).toBe(true);
  expect(isModelScopeRepoId('1')).toBe(false);
  expect(isModelScopeRepoId('Qwen/')).toBe(false);
  expect(isModelScopeRepoId('/Qwen3-8B-GGUF')).toBe(false);
});

test('streaming assistant display shows waiting dots until content or thinking arrives', async () => {
  const module = await import('./LocalInferenceView');
  const buildStreamingAssistantMessage = (module as {
    __test__buildStreamingAssistantMessage?: (input: {
      content: string;
      thinking: string;
    }) => { content: string; thinking?: string; waiting?: boolean; createdAt: number };
  }).__test__buildStreamingAssistantMessage;

  expect(typeof buildStreamingAssistantMessage).toBe('function');
  if (!buildStreamingAssistantMessage) return;

  expect(buildStreamingAssistantMessage({ content: '', thinking: '' })).toEqual(
    expect.objectContaining({
      content: '',
      waiting: true,
    }),
  );

  expect(buildStreamingAssistantMessage({ content: '', thinking: 'checking' })).toEqual(
    expect.objectContaining({
      content: '',
      thinking: 'checking',
      waiting: false,
    }),
  );

  expect(buildStreamingAssistantMessage({ content: 'answer', thinking: 'checking' })).toEqual(
    expect.objectContaining({
      content: 'answer',
      thinking: 'checking',
      waiting: false,
    }),
  );
});

test('new prompt scroll target points at the next assistant response start', async () => {
  const module = await import('./LocalInferenceView');
  const getNewAssistantScrollTargetIndex = (module as {
    __test__getNewAssistantScrollTargetIndex?: (historyLength: number) => number;
  }).__test__getNewAssistantScrollTargetIndex;
  const getAssistantScrollTop = (module as {
    __test__getAssistantScrollTop?: (input: {
      containerScrollTop: number;
      containerTop: number;
      targetTop: number;
      offset?: number;
    }) => number;
  }).__test__getAssistantScrollTop;

  expect(typeof getNewAssistantScrollTargetIndex).toBe('function');
  expect(typeof getAssistantScrollTop).toBe('function');
  if (!getNewAssistantScrollTargetIndex || !getAssistantScrollTop) return;

  expect(getNewAssistantScrollTargetIndex(0)).toBe(1);
  expect(getNewAssistantScrollTargetIndex(4)).toBe(5);
  expect(
    getAssistantScrollTop({
      containerScrollTop: 320,
      containerTop: 100,
      targetTop: 240,
    }),
  ).toBe(460);
  expect(
    getAssistantScrollTop({
      containerScrollTop: 5,
      containerTop: 100,
      targetTop: 110,
    }),
  ).toBe(15);
});

test('jump-to-bottom visibility logic only triggers when content remains below viewport', async () => {
  const module = await import('./LocalInferenceView');
  const isScrollNearBottom = (module as {
    __test__isScrollNearBottom?: (input: {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
      threshold?: number;
    }) => boolean;
  }).__test__isScrollNearBottom;
  const hasHiddenContentBelow = (module as {
    __test__hasHiddenContentBelow?: (input: {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
      threshold?: number;
    }) => boolean;
  }).__test__hasHiddenContentBelow;

  expect(typeof isScrollNearBottom).toBe('function');
  expect(typeof hasHiddenContentBelow).toBe('function');
  if (!isScrollNearBottom || !hasHiddenContentBelow) return;

  expect(
    isScrollNearBottom({
      scrollTop: 900,
      clientHeight: 300,
      scrollHeight: 1260,
    }),
  ).toBe(true);

  expect(
    isScrollNearBottom({
      scrollTop: 720,
      clientHeight: 300,
      scrollHeight: 1260,
    }),
  ).toBe(false);

  expect(
    hasHiddenContentBelow({
      scrollTop: 720,
      clientHeight: 300,
      scrollHeight: 1260,
    }),
  ).toBe(true);

  expect(
    hasHiddenContentBelow({
      scrollTop: 952,
      clientHeight: 300,
      scrollHeight: 1260,
    }),
  ).toBe(false);
});

test('final assistant message keeps visible content and preserves thinking details', async () => {
  const module = await import('./LocalInferenceView');
  const buildAssistantMessage = (module as {
    __test__buildAssistantMessage?: (input: {
      content: string;
      thinking: string;
    }) => { content: string; thinking?: string; createdAt: number; reasoningDurationSeconds?: number };
  }).__test__buildAssistantMessage;

  expect(typeof buildAssistantMessage).toBe('function');
  if (!buildAssistantMessage) return;

  const message = buildAssistantMessage({
    content: 'answer',
    thinking: 'hidden chain',
  });

  expect(message.content).toBe('answer');
  expect(message.thinking).toBe('hidden chain');
  expect(message.createdAt).toBeTypeOf('number');
});

test('final assistant message falls back to a generic notice when no visible answer exists', async () => {
  const module = await import('./LocalInferenceView');
  const buildAssistantMessage = (module as {
    __test__buildAssistantMessage?: (input: {
      content: string;
      thinking: string;
    }) => { content: string; thinking?: string; createdAt: number; reasoningDurationSeconds?: number };
  }).__test__buildAssistantMessage;

  expect(typeof buildAssistantMessage).toBe('function');
  if (!buildAssistantMessage) return;

  const message = buildAssistantMessage({
    content: '',
    thinking: 'hidden chain',
  });

  expect(message.content).toBeTruthy();
  expect(message.content).not.toContain('hidden chain');
  expect(message.thinking).toBe('hidden chain');
  expect(message.createdAt).toBeTypeOf('number');
});

test('latest user message index resolves the active conversation turn', async () => {
  const module = await import('./LocalInferenceView');
  const findLatestUserMessageIndex = (module as unknown as {
    __test__findLatestUserMessageIndex?: (
      messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt: number }>,
    ) => number;
  }).__test__findLatestUserMessageIndex;

  expect(typeof findLatestUserMessageIndex).toBe('function');
  if (!findLatestUserMessageIndex) return;

  expect(
    findLatestUserMessageIndex([
      { role: 'user', content: 'first', createdAt: 1 },
      { role: 'assistant', content: 'reply', createdAt: 2 },
      { role: 'user', content: 'latest', createdAt: 3 },
      { role: 'assistant', content: 'final', createdAt: 4 },
    ]),
  ).toBe(2);
  expect(findLatestUserMessageIndex([{ role: 'assistant', content: 'reply', createdAt: 1 }])).toBe(
    -1,
  );
});

test('model card busy state only locks the unloading model card', async () => {
  const module = await import('./LocalInferenceView');
  const getModelCardBusyState = (module as {
    __test__getModelCardBusyState?: (input: {
      modelName: string;
      unloadingModelName: string | null;
      globalLoading: boolean;
    }) => { cardBusy: boolean; buttonsDisabled: boolean };
  }).__test__getModelCardBusyState;

  expect(typeof getModelCardBusyState).toBe('function');
  if (!getModelCardBusyState) return;

  expect(
    getModelCardBusyState({
      modelName: 'model-a',
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
      unloadingModelName: null,
      globalLoading: true,
    }),
  ).toEqual({
    cardBusy: false,
    buttonsDisabled: true,
  });
});

test('model action guard blocks operations for the unloading model only', async () => {
  const module = await import('./LocalInferenceView');
  const shouldBlockModelAction = (module as {
    __test__shouldBlockModelAction?: (input: {
      modelName: string;
      unloadingModelName: string | null;
    }) => boolean;
  }).__test__shouldBlockModelAction;

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
  const getRemainingBusyMs = (module as {
    __test__getRemainingBusyMs?: (input: {
      startedAtMs: number;
      nowMs: number;
      minimumBusyMs: number;
    }) => number;
  }).__test__getRemainingBusyMs;

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

test('local inference transient notices auto-dismiss within five seconds', async () => {
  const module = await import('./LocalInferenceView');
  const isInstallTerminalPhase = (module as {
    __test__isInstallTerminalPhase?: (phase: string) => boolean;
  }).__test__isInstallTerminalPhase;
  const getLocalInferenceToastAutoDismissMs = (module as {
    __test__getLocalInferenceToastAutoDismissMs?: () => number;
  }).__test__getLocalInferenceToastAutoDismissMs;
  const getLocalInferenceProgressDismissMs = (module as {
    __test__getLocalInferenceProgressDismissMs?: () => number;
  }).__test__getLocalInferenceProgressDismissMs;

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
  const formatInstallProgressSummary = (module as {
    __test__formatInstallProgressSummary?: (progress: Record<string, unknown>) => {
      primary: string;
      phase?: string;
      error?: string;
    };
  }).__test__formatInstallProgressSummary;

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
