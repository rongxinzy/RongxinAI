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

  expect(buildMarketplaceSearchParams({
    query: ' / ',
  })).toBeNull();
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
  const groups = Array.from(new Set(fields.map((field) => field.group))).sort();
  const serviceKeys = fields.filter((field) => field.group === 'service').map((field) => field.key);
  const cacheKeys = fields.filter((field) => field.group === 'cache').map((field) => field.key);
  const gpuKeys = fields.filter((field) => field.group === 'gpu').map((field) => field.key);
  const compatKeys = fields.filter((field) => field.group === 'compat').map((field) => field.key);
  const requestKeys = fields.filter((field) => field.group === 'request').map((field) => field.key);

  expect(fields.length).toBeGreaterThan(0);
  expect(fields.map((field) => field.paramName)).toContain('parallel');
  expect(fields.every((field) => !field.paramName.startsWith('--'))).toBe(true);
  expect(groups).toEqual(['cache', 'compat', 'gpu', 'request', 'service']);
  expect(serviceKeys).toEqual(['modelsMax', 'modelsAutoload', 'timeout']);
  expect(cacheKeys).toEqual(['cachePrompt', 'cacheReuse', 'cacheRam']);
  expect(gpuKeys).toEqual(['device', 'splitMode', 'tensorSplit', 'mainGpu', 'flashAttn']);
  expect(compatKeys).toEqual(['jinja', 'mlock']);
  expect(requestKeys).toEqual(['parallel', 'threadsHttp']);
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

test('launch gpu presets pin explicit devices for dual-gpu workstations', async () => {
  const module = await import('./LocalInferenceView');
  const resolveLaunchServiceConfig = (module as unknown as {
    __test__resolveLaunchServiceConfig?: (
      preset: string,
      customGpuDevices: string,
    ) => { device?: string; splitMode?: string } | null;
  }).__test__resolveLaunchServiceConfig;
  const formatLaunchGpuPresetSummary = (module as unknown as {
    __test__formatLaunchGpuPresetSummary?: (preset: string, customGpuDevices: string) => string;
  }).__test__formatLaunchGpuPresetSummary;

  expect(typeof resolveLaunchServiceConfig).toBe('function');
  expect(typeof formatLaunchGpuPresetSummary).toBe('function');
  if (!resolveLaunchServiceConfig) return;
  if (!formatLaunchGpuPresetSummary) return;

  expect(resolveLaunchServiceConfig('service-default', '')).toBeNull();
  expect(resolveLaunchServiceConfig('single-auto', '')).toEqual({
    device: 'CUDA0',
    splitMode: 'none',
  });
  expect(resolveLaunchServiceConfig('dual-gpu', '')).toEqual({
    device: 'CUDA0,CUDA1',
    splitMode: 'layer',
  });
  expect(resolveLaunchServiceConfig('custom', '0,1')).toEqual({
    device: 'CUDA0,CUDA1',
    splitMode: 'none',
  });
  expect(resolveLaunchServiceConfig('custom', 'bad input')).toBeNull();
  expect(formatLaunchGpuPresetSummary('dual-gpu', '')).toContain('CUDA0,CUDA1');
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
  expect(paramNames).toContain('reasoning');
  expect(paramNames).not.toContain('num_predict');
  expect(paramNames.every((paramName) => !paramName.startsWith('--'))).toBe(true);
  expect(basicKeys).toEqual([
    'num_predict',
    'reasoning_preference',
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
    }) => { content: string; thinking?: string; waiting?: boolean; createdAt: number };
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
  const buildAssistantMessage = (module as unknown as {
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

test('launch dialog shows models-max notice before starting a second model', async () => {
  const module = await import('./LocalInferenceView');
  const getModelsMaxLimitNotice = (module as unknown as {
    __test__getModelsMaxLimitNotice?: (input: {
      modelsMax: string | undefined;
      targetModelName: string;
      runningModelNames: string[];
    }) => { message: string; limit: number; next: number } | null;
  }).__test__getModelsMaxLimitNotice;

  expect(typeof getModelsMaxLimitNotice).toBe('function');
  if (!getModelsMaxLimitNotice) return;

  expect(getModelsMaxLimitNotice({
    modelsMax: '1',
    targetModelName: 'Qwen3-8B',
    runningModelNames: ['DeepSeek-R1-7B'],
  })).toEqual(expect.objectContaining({
    limit: 1,
    next: 2,
  }));

  expect(getModelsMaxLimitNotice({
    modelsMax: '1',
    targetModelName: 'Qwen3-8B',
    runningModelNames: ['Qwen3-8B'],
  })).toBeNull();
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

test('latest user message index resolves the active conversation turn', async () => {
  const module = await import('./LocalInferenceView');
  const findLatestUserMessageIndex = (module as unknown as {
    __test__findLatestUserMessageIndex?: (messages: Array<{ role: 'user' | 'assistant'; content: string }>) => number;
  }).__test__findLatestUserMessageIndex;

  expect(typeof findLatestUserMessageIndex).toBe('function');
  if (!findLatestUserMessageIndex) return;

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
