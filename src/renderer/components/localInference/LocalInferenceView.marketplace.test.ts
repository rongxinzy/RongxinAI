import { expect, test } from 'vitest';

test('marketplace page size is fixed across viewport sizes', async () => {
  const module = await import('./LocalInferenceView');
  const getMarketplacePageSize = (module as unknown as {
    __test__getMarketplacePageSize?: () => number;
  }).__test__getMarketplacePageSize;

  expect(typeof getMarketplacePageSize).toBe('function');
  if (!getMarketplacePageSize) return;

  expect(getMarketplacePageSize()).toBe(6);
});

test('marketplace search params load directly up to the app and openapi caps', async () => {
  const module = await import('./LocalInferenceView');
  const buildMarketplaceSearchParams = (module as unknown as {
    __test__buildMarketplaceSearchParams?: (input: {
      query: string;
      pageNumber?: number;
    }) => { query?: string; task?: string; size?: string; limit?: number; pageNumber?: number } | null;
  }).__test__buildMarketplaceSearchParams;

  expect(typeof buildMarketplaceSearchParams).toBe('function');
  if (!buildMarketplaceSearchParams) return;

  expect(buildMarketplaceSearchParams({
    query: ' qwen ',
  })).toEqual({ query: 'qwen', limit: 3000 });

  expect(buildMarketplaceSearchParams({
    query: ' qwen ',
  })).toEqual({
    query: 'qwen',
    limit: 3000,
  });

  expect(buildMarketplaceSearchParams({
    query: ' qwen ',
    pageNumber: 4,
  })).toEqual({ query: 'qwen', limit: 3000, pageNumber: 4 });

  expect(buildMarketplaceSearchParams({
    query: '',
  })).toBeNull();
});

test('modelscope manual install requires owner repo id', async () => {
  const module = await import('./LocalInferenceView');
  const isModelScopeRepoId = (module as unknown as {
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

test('llama.cpp service config field metadata uses UI parameter keys without CLI prefixes', async () => {
  const module = await import('./LocalInferenceView');
  const getServiceConfigFields = (module as unknown as {
    __test__getServiceConfigFields?: () => Array<{ key: string; group: string; paramName: string }>;
  }).__test__getServiceConfigFields;

  expect(typeof getServiceConfigFields).toBe('function');
  if (!getServiceConfigFields) return;

  const fields = getServiceConfigFields();
  const keys = fields.map((field) => field.key);
  const basicKeys = fields.filter((field) => field.group === 'basic').map((field) => field.key);

  expect(fields.length).toBeGreaterThan(0);
  expect(fields.map((field) => field.paramName)).toContain('parallel');
  expect(fields.every((field) => !field.paramName.startsWith('--'))).toBe(true);
  expect(basicKeys).toEqual(['modelsMax', 'modelsAutoload', 'parallel', 'timeout']);
  expect(keys).not.toContain('host');
  expect(keys).not.toContain('port');
  expect(keys).not.toContain('ctxSize');
  expect(keys).not.toContain('gpuLayers');
  expect(keys).not.toContain('batchSize');
  expect(keys).not.toContain('ubatchSize');
  expect(keys).not.toContain('threads');
  expect(keys).not.toContain('threadsBatch');
  expect(keys).not.toContain('mmap');
  expect(keys).not.toContain('reasoning');
  expect(keys).not.toContain('reasoningFormat');
  expect(keys).not.toContain('reasoningBudget');
});

test('llama.cpp inference option metadata uses OpenAI-compatible request parameter keys', async () => {
  const module = await import('./LocalInferenceView');
  const getInferenceOptionFields = (module as unknown as {
    __test__getInferenceOptionFields?: () => Array<{ key: string; group: string; paramName: string }>;
  }).__test__getInferenceOptionFields;

  expect(typeof getInferenceOptionFields).toBe('function');
  if (!getInferenceOptionFields) return;

  const fields = getInferenceOptionFields();
  const paramNames = fields.map((field) => field.paramName);
  const basicKeys = fields.filter((field) => field.group === 'basic').map((field) => field.key);
  const advancedKeys = fields.filter((field) => field.group === 'advanced').map((field) => field.key);

  expect(paramNames).toContain('max_tokens');
  expect(paramNames).toContain('app.system_hint.direct_answer_only');
  expect(paramNames).not.toContain('num_predict');
  expect(paramNames.every((paramName) => !paramName.startsWith('--'))).toBe(true);
  expect(basicKeys).toEqual([
    'num_predict',
    'direct_answer_mode',
    'temperature',
    'top_p',
  ]);
  expect(advancedKeys).toEqual([
    'top_k',
    'min_p',
    'repeat_penalty',
    'presence_penalty',
    'cache_prompt',
    'seed',
    'stop',
  ]);
  expect([...basicKeys, ...advancedKeys].sort()).toEqual(fields.map((field) => field.key).sort());
});

test('streaming assistant display shows waiting dots until content or thinking arrives', async () => {
  const module = await import('./LocalInferenceView');
  const buildStreamingAssistantMessage = (module as unknown as {
    __test__buildStreamingAssistantMessage?: (input: {
      content: string;
      thinking: string;
    }) => { content: string; thinking?: string; waiting?: boolean; hiddenThinking?: boolean };
  }).__test__buildStreamingAssistantMessage;

  expect(typeof buildStreamingAssistantMessage).toBe('function');
  if (!buildStreamingAssistantMessage) return;

  expect(buildStreamingAssistantMessage({
    content: '',
    thinking: '',
  })).toEqual(expect.objectContaining({
    content: '',
    waiting: true,
  }));

  expect(buildStreamingAssistantMessage({
    content: '',
    thinking: 'checking',
  })).toEqual(expect.objectContaining({
    content: '',
    thinking: 'checking',
    waiting: false,
  }));

  expect(buildStreamingAssistantMessage({
    content: 'answer',
    thinking: 'checking',
  })).toEqual(expect.objectContaining({
    content: 'answer',
    thinking: 'checking',
    waiting: false,
  }));
});

test('new prompt scroll target points at the next assistant response start', async () => {
  const module = await import('./LocalInferenceView');
  const getNewAssistantScrollTargetIndex = (module as unknown as {
    __test__getNewAssistantScrollTargetIndex?: (historyLength: number) => number;
  }).__test__getNewAssistantScrollTargetIndex;
  const getAssistantScrollTop = (module as unknown as {
    __test__getAssistantScrollTop?: (input: {
      containerScrollTop: number;
      containerTop: number;
      targetTop: number;
      offset?: number;
    }) => number;
  }).__test__getAssistantScrollTop;

  expect(typeof getNewAssistantScrollTargetIndex).toBe('function');
  expect(typeof getAssistantScrollTop).toBe('function');
  if (!getNewAssistantScrollTargetIndex) return;
  if (!getAssistantScrollTop) return;

  expect(getNewAssistantScrollTargetIndex(0)).toBe(1);
  expect(getNewAssistantScrollTargetIndex(4)).toBe(5);
  expect(getAssistantScrollTop({
    containerScrollTop: 320,
    containerTop: 100,
    targetTop: 240,
  })).toBe(460);
  expect(getAssistantScrollTop({
    containerScrollTop: 5,
    containerTop: 100,
    targetTop: 110,
  })).toBe(15);
});

test('jump-to-bottom visibility logic only triggers when content remains below viewport', async () => {
  const module = await import('./LocalInferenceView');
  const isScrollNearBottom = (module as unknown as {
    __test__isScrollNearBottom?: (input: {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
      threshold?: number;
    }) => boolean;
  }).__test__isScrollNearBottom;
  const hasHiddenContentBelow = (module as unknown as {
    __test__hasHiddenContentBelow?: (input: {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
      threshold?: number;
    }) => boolean;
  }).__test__hasHiddenContentBelow;

  expect(typeof isScrollNearBottom).toBe('function');
  expect(typeof hasHiddenContentBelow).toBe('function');
  if (!isScrollNearBottom) return;
  if (!hasHiddenContentBelow) return;

  expect(isScrollNearBottom({
    scrollTop: 900,
    clientHeight: 300,
    scrollHeight: 1260,
  })).toBe(true);

  expect(isScrollNearBottom({
    scrollTop: 720,
    clientHeight: 300,
    scrollHeight: 1260,
  })).toBe(false);

  expect(hasHiddenContentBelow({
    scrollTop: 720,
    clientHeight: 300,
    scrollHeight: 1260,
  })).toBe(true);

  expect(hasHiddenContentBelow({
    scrollTop: 952,
    clientHeight: 300,
    scrollHeight: 1260,
  })).toBe(false);
});

test('final assistant message keeps visible content and preserves thinking details', async () => {
  const module = await import('./LocalInferenceView');
  const buildAssistantMessage = (module as unknown as {
    __test__buildAssistantMessage?: (input: {
      content: string;
      thinking: string;
      metrics: unknown;
    }) => { content: string; thinking?: string; hiddenThinking?: boolean };
  }).__test__buildAssistantMessage;

  expect(typeof buildAssistantMessage).toBe('function');
  if (!buildAssistantMessage) return;

  const message = buildAssistantMessage({
    content: 'answer',
    thinking: 'hidden chain',
    metrics: null,
  });

  expect(message.content).toBe('answer');
  expect(message.thinking).toBe('hidden chain');
  expect(message.hiddenThinking).toBeUndefined();
});

test('final assistant message falls back to a generic notice when no visible answer exists', async () => {
  const module = await import('./LocalInferenceView');
  const buildAssistantMessage = (module as unknown as {
    __test__buildAssistantMessage?: (input: {
      content: string;
      thinking: string;
      metrics: unknown;
    }) => { content: string; thinking?: string; hiddenThinking?: boolean };
  }).__test__buildAssistantMessage;

  expect(typeof buildAssistantMessage).toBe('function');
  if (!buildAssistantMessage) return;

  const message = buildAssistantMessage({
    content: '',
    thinking: 'hidden chain',
    metrics: null,
  });

  expect(message.content).toBeTruthy();
  expect(message.content).not.toContain('hidden chain');
  expect(message.thinking).toBe('hidden chain');
  expect(message.hiddenThinking).toBeUndefined();
});

test('launch dialog flags ctx-size values that exceed the trained context limit', async () => {
  const module = await import('./LocalInferenceView');
  const getLaunchContextLimitMessage = (module as unknown as {
    __test__getLaunchContextLimitMessage?: (input: {
      requestedContextLength?: number;
      trainedContextLength?: number;
    }) => { requestedContextLength: number; trainedContextLength: number } | null;
  }).__test__getLaunchContextLimitMessage;

  expect(typeof getLaunchContextLimitMessage).toBe('function');
  if (!getLaunchContextLimitMessage) return;

  expect(getLaunchContextLimitMessage({
    requestedContextLength: 32768,
    trainedContextLength: 32768,
  })).toBeNull();

  expect(getLaunchContextLimitMessage({
    requestedContextLength: 32769,
    trainedContextLength: 32768,
  })).toEqual({
    requestedContextLength: 32769,
    trainedContextLength: 32768,
  });
});

test('model card busy state only locks the unloading model card', async () => {
  const module = await import('./LocalInferenceView');
  const getModelCardBusyState = (module as unknown as {
    __test__getModelCardBusyState?: (input: {
      modelName: string;
      unloadingModelName: string | null;
      globalLoading: boolean;
    }) => { cardBusy: boolean; buttonsDisabled: boolean };
  }).__test__getModelCardBusyState;

  expect(typeof getModelCardBusyState).toBe('function');
  if (!getModelCardBusyState) return;

  expect(getModelCardBusyState({
    modelName: 'model-a',
    unloadingModelName: 'model-a',
    globalLoading: false,
  })).toEqual({
    cardBusy: true,
    buttonsDisabled: true,
  });

  expect(getModelCardBusyState({
    modelName: 'model-b',
    unloadingModelName: 'model-a',
    globalLoading: false,
  })).toEqual({
    cardBusy: false,
    buttonsDisabled: false,
  });

  expect(getModelCardBusyState({
    modelName: 'model-b',
    unloadingModelName: null,
    globalLoading: true,
  })).toEqual({
    cardBusy: false,
    buttonsDisabled: true,
  });
});

test('model action guard blocks operations for the unloading model only', async () => {
  const module = await import('./LocalInferenceView');
  const shouldBlockModelAction = (module as unknown as {
    __test__shouldBlockModelAction?: (input: {
      modelName: string;
      unloadingModelName: string | null;
    }) => boolean;
  }).__test__shouldBlockModelAction;

  expect(typeof shouldBlockModelAction).toBe('function');
  if (!shouldBlockModelAction) return;

  expect(shouldBlockModelAction({
    modelName: 'model-a',
    unloadingModelName: 'model-a',
  })).toBe(true);

  expect(shouldBlockModelAction({
    modelName: 'model-b',
    unloadingModelName: 'model-a',
  })).toBe(false);

  expect(shouldBlockModelAction({
    modelName: 'model-a',
    unloadingModelName: null,
  })).toBe(false);
});

test('unload busy state keeps a minimum visible duration', async () => {
  const module = await import('./LocalInferenceView');
  const getRemainingBusyMs = (module as unknown as {
    __test__getRemainingBusyMs?: (input: {
      startedAtMs: number;
      nowMs: number;
      minimumBusyMs: number;
    }) => number;
  }).__test__getRemainingBusyMs;

  expect(typeof getRemainingBusyMs).toBe('function');
  if (!getRemainingBusyMs) return;

  expect(getRemainingBusyMs({
    startedAtMs: 100,
    nowMs: 250,
    minimumBusyMs: 500,
  })).toBe(350);

  expect(getRemainingBusyMs({
    startedAtMs: 100,
    nowMs: 700,
    minimumBusyMs: 500,
  })).toBe(0);
});

test('metrics summary uses usage token counts first', async () => {
  const module = await import('./LocalInferenceView');
  const formatMetricsSummary = (module as unknown as {
    __test__formatMetricsSummary?: (metrics: unknown) => string;
  }).__test__formatMetricsSummary;

  expect(typeof formatMetricsSummary).toBe('function');
  if (!formatMetricsSummary) return;

  const summary = formatMetricsSummary({
    usage: {
      prompt_tokens: 11,
      completion_tokens: 13,
      total_tokens: 24,
    },
    timings: {
      predicted_n: 99,
      predicted_per_second: 8.25,
    },
  });

  expect(summary).toContain('11');
  expect(summary).toContain('13');
  expect(summary).toContain('24');
  expect(summary).toContain('8.3');
});

test('metrics summary falls back to timings and legacy fields', async () => {
  const module = await import('./LocalInferenceView');
  const formatMetricsSummary = (module as unknown as {
    __test__formatMetricsSummary?: (metrics: unknown) => string;
  }).__test__formatMetricsSummary;

  expect(typeof formatMetricsSummary).toBe('function');
  if (!formatMetricsSummary) return;

  expect(formatMetricsSummary({
    timings: {
      prompt_n: 7,
      predicted_n: 5,
      predicted_per_second: 3,
    },
  })).toContain('7');
  expect(formatMetricsSummary({
    prompt_eval_count: 4,
    eval_count: 6,
    predicted_per_second: 2,
  })).toContain('10');
});

test('request preview exposes the important llama.cpp body fields', async () => {
  const module = await import('./LocalInferenceView');
  const buildRequestPreview = (module as unknown as {
    __test__buildRequestPreview?: (input: {
      model: string;
      systemPrompt: string;
      options: Record<string, unknown>;
    }) => Record<string, unknown>;
  }).__test__buildRequestPreview;

  expect(typeof buildRequestPreview).toBe('function');
  if (!buildRequestPreview) return;

  const preview = buildRequestPreview({
    model: 'DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
    systemPrompt: 'reply with over',
    options: {
      max_tokens: 256,
      temperature: 0.7,
    },
  });

  expect(preview).toEqual({
    model: 'DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
    messages: [{ role: 'system', content: 'reply with over' }],
    max_tokens: 256,
  });
});

test('composer height maps to safe chat padding and jump button offset', async () => {
  const module = await import('./LocalInferenceView');
  const getChatBottomPadding = (module as unknown as {
    __test__getChatBottomPadding?: (composerHeight: number) => number;
  }).__test__getChatBottomPadding;
  const getJumpToBottomOffset = (module as unknown as {
    __test__getJumpToBottomOffset?: (composerHeight: number) => number;
  }).__test__getJumpToBottomOffset;
  const getLatestTurnContentHeight = (module as unknown as {
    __test__getLatestTurnContentHeight?: (scrollHeight: number, latestTurnTop: number) => number;
  }).__test__getLatestTurnContentHeight;
  const getLatestTurnTailSpacer = (module as unknown as {
    __test__getLatestTurnTailSpacer?: (viewportHeight: number, bottomPadding: number) => number;
  }).__test__getLatestTurnTailSpacer;
  const getEffectiveChatScrollHeight = (module as unknown as {
    __test__getEffectiveChatScrollHeight?: (scrollHeight: number, tailSpacer: number) => number;
  }).__test__getEffectiveChatScrollHeight;
  const findLatestUserMessageIndex = (module as unknown as {
    __test__findLatestUserMessageIndex?: (messages: Array<{ role: 'user' | 'assistant'; content: string }>) => number;
  }).__test__findLatestUserMessageIndex;

  expect(typeof getChatBottomPadding).toBe('function');
  expect(typeof getJumpToBottomOffset).toBe('function');
  expect(typeof getLatestTurnContentHeight).toBe('function');
  expect(typeof getLatestTurnTailSpacer).toBe('function');
  expect(typeof getEffectiveChatScrollHeight).toBe('function');
  expect(typeof findLatestUserMessageIndex).toBe('function');
  if (!getChatBottomPadding) return;
  if (!getJumpToBottomOffset) return;
  if (!getLatestTurnContentHeight) return;
  if (!getLatestTurnTailSpacer) return;
  if (!getEffectiveChatScrollHeight) return;
  if (!findLatestUserMessageIndex) return;

  expect(getChatBottomPadding(48)).toBe(120);
  expect(getChatBottomPadding(136)).toBe(156);
  expect(getJumpToBottomOffset(48)).toBe(92);
  expect(getJumpToBottomOffset(136)).toBe(152);
  expect(getLatestTurnContentHeight(1200, 716)).toBe(484);
  expect(getLatestTurnContentHeight(1200, 180)).toBe(1020);
  expect(getLatestTurnTailSpacer(640, 156)).toBe(484);
  expect(getLatestTurnTailSpacer(640, 720)).toBe(0);
  expect(getLatestTurnTailSpacer(120, 156)).toBe(0);
  expect(getEffectiveChatScrollHeight(1200, 484)).toBe(716);
  expect(getEffectiveChatScrollHeight(300, 484)).toBe(0);
  expect(findLatestUserMessageIndex([
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'latest' },
    { role: 'assistant', content: 'final' },
  ])).toBe(2);
  expect(findLatestUserMessageIndex([{ role: 'assistant', content: 'reply' }])).toBe(-1);
});

test('local inference transient notices auto-dismiss within five seconds', async () => {
  const module = await import('./LocalInferenceView');
  const isInstallTerminalPhase = (module as unknown as {
    __test__isInstallTerminalPhase?: (phase: string) => boolean;
  }).__test__isInstallTerminalPhase;
  const getLocalInferenceToastAutoDismissMs = (module as unknown as {
    __test__getLocalInferenceToastAutoDismissMs?: () => number;
  }).__test__getLocalInferenceToastAutoDismissMs;
  const getLocalInferenceProgressDismissMs = (module as unknown as {
    __test__getLocalInferenceProgressDismissMs?: () => number;
  }).__test__getLocalInferenceProgressDismissMs;

  expect(typeof isInstallTerminalPhase).toBe('function');
  expect(typeof getLocalInferenceToastAutoDismissMs).toBe('function');
  expect(typeof getLocalInferenceProgressDismissMs).toBe('function');
  if (!isInstallTerminalPhase) return;
  if (!getLocalInferenceToastAutoDismissMs) return;
  if (!getLocalInferenceProgressDismissMs) return;

  expect(getLocalInferenceToastAutoDismissMs()).toBeLessThanOrEqual(5000);
  expect(getLocalInferenceProgressDismissMs()).toBeLessThanOrEqual(5000);
  expect(isInstallTerminalPhase('done')).toBe(true);
  expect(isInstallTerminalPhase('failed')).toBe(true);
  expect(isInstallTerminalPhase('cancelled')).toBe(true);
  expect(isInstallTerminalPhase('needs-manual')).toBe(true);
  expect(isInstallTerminalPhase('downloading-progress')).toBe(false);
});
