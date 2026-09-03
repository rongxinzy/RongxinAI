import { expect, test, vi } from 'vitest';

import {
  LlamaCppIpcChannel,
  LlamaCppRuntimeBackend,
  LlamaCppRuntimeCudaMajor,
  LlamaCppMemoryPolicy,
} from '../../shared/llamacpp';
import { ModelCapabilityStatus } from '../../shared/providers';
import type { LlamaCppManager } from '../libs/llamacppManager';
import {
  enforceLlamaCppParallelTwo,
  getLlamaCppLoadedModelLimitViolation,
  getLlamaCppServiceConfig,
  getRequiredVramRecoveryMiB,
  getTotalFreeVramMiB,
  hasRecoveredVram,
  sanitizeLlamaCppServiceConfig,
  sanitizeLlamaCppModelPreference,
  waitForLlamaCppModelUnloadConfirmation,
  waitForLlamaCppStartupModelBindings,
  registerLlamaCppIpcHandlers,
} from './llamacpp';

test('sanitizeLlamaCppModelPreference retains every supported capability field', () => {
  expect(
    sanitizeLlamaCppModelPreference({
      ctxSize: '65536',
      maxTokens: '8192',
      capabilities: {
        toolCalling: ModelCapabilityStatus.Supported,
        imageInput: ModelCapabilityStatus.Unsupported,
        videoInput: ModelCapabilityStatus.Unknown,
        audioInput: ModelCapabilityStatus.Supported,
        documentInput: ModelCapabilityStatus.Unsupported,
        reasoning: ModelCapabilityStatus.Supported,
        ignored: ModelCapabilityStatus.Supported,
      },
    }),
  ).toEqual({
    ctxSize: 65536,
    maxTokens: 8192,
    capabilities: {
      toolCalling: ModelCapabilityStatus.Supported,
      imageInput: ModelCapabilityStatus.Unsupported,
      videoInput: ModelCapabilityStatus.Unknown,
      audioInput: ModelCapabilityStatus.Supported,
      documentInput: ModelCapabilityStatus.Unsupported,
      reasoning: ModelCapabilityStatus.Supported,
    },
  });
});

test('sanitizeLlamaCppModelPreference drops invalid maximum output and capability values', () => {
  expect(
    sanitizeLlamaCppModelPreference({
      maxTokens: 0,
      capabilities: { toolCalling: 'yes' },
    }),
  ).toBeNull();
});

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  windows: [] as Array<{
    isDestroyed: () => boolean;
    webContents: { send: ReturnType<typeof vi.fn> };
  }>,
}));

vi.mock('electron', () => ({
  app: { getPath: () => 'test-user-data' },
  BrowserWindow: { getAllWindows: () => electronMocks.windows },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    }),
  },
}));

test('enforceLlamaCppParallelTwo updates an existing saved service config without changing ctxSize', () => {
  const set = vi.fn();
  const store = {
    get: () => ({ ctxSize: '65536', parallel: '1', threadsHttp: '12' }),
    set,
  } as unknown as Parameters<typeof enforceLlamaCppParallelTwo>[0];

  enforceLlamaCppParallelTwo(store);

  expect(set).toHaveBeenCalledWith('llamacpp_service_config', {
    ctxSize: '65536',
    parallel: '2',
    threadsHttp: '12',
  });
});

test('sanitizeLlamaCppServiceConfig keeps valid fields and falls back for malformed structured numbers', () => {
  expect(
    sanitizeLlamaCppServiceConfig({
      host: ' 0.0.0.0 ',
      port: 'not-a-port',
      modelsDir: ' /tmp/models ',
      modelsMax: '2',
      modelsAutoload: 'true' as unknown as boolean,
      ctxSize: '8192',
      parallel: '2x',
      gpuLayers: 'all',
      threads: '8',
      batchSize: '256',
      ubatchSize: '64',
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
      device: ' 0,1 ',
      mainGpu: '-1',
      splitMode: 'layer',
      tensorSplit: ' 3,2 ',
      flashAttn: 'maybe' as 'auto',
      reasoning: 'on',
      chatTemplate: 'chatml',
      reasoningFormat: 'invalid' as 'auto',
    }),
  ).toEqual({
    host: '127.0.0.1',
    listenHost: '0.0.0.0',
    modelsDir: '/tmp/models',
    modelsMax: '2',
    modelsAutoload: false,
    ctxSize: '8192',
    parallel: '2',
    gpuLayers: 'all',
    threads: '8',
    batchSize: '256',
    ubatchSize: '64',
    runtimeBackend: LlamaCppRuntimeBackend.Cuda,
    runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
    device: '0,1',
    mainGpu: '0',
    splitMode: 'layer',
    reasoning: 'on',
    chatTemplate: 'chatml',
  });
});

test('getLlamaCppServiceConfig maps legacy listen-all host to listenHost while keeping localhost client access', () => {
  const store = {
    get: () => ({ host: '0.0.0.0', port: '8080' }),
  } as unknown as Parameters<typeof getLlamaCppServiceConfig>[0];

  expect(getLlamaCppServiceConfig(store)).toEqual({
    host: '127.0.0.1',
    listenHost: '0.0.0.0',
    port: '8080',
    modelsMax: '3',
    keepRunningOnAppQuit: true,
    timeout: '120',
    threadsHttp: '4',
    cacheReuse: '256',
    cacheRam: '8192',
    parallel: '2',
    kvUnified: true,
    batchSize: '512',
    ubatchSize: '512',
    gpuLayers: 'auto',
    memoryPolicy: LlamaCppMemoryPolicy.Auto,
    memoryBudgetPercent: 50,
  });
});

test('sanitizeLlamaCppServiceConfig keeps a valid manual memory budget and defaults invalid policies to auto', () => {
  expect(
    sanitizeLlamaCppServiceConfig({
      memoryPolicy: LlamaCppMemoryPolicy.Manual,
      memoryBudgetPercent: 50,
    }),
  ).toEqual({ memoryPolicy: LlamaCppMemoryPolicy.Manual, memoryBudgetPercent: 50 });

  expect(
    sanitizeLlamaCppServiceConfig({
      memoryPolicy: 'invalid' as LlamaCppMemoryPolicy,
      memoryBudgetPercent: 91,
    }),
  ).toEqual({});
});

test('sanitizeLlamaCppServiceConfig disables autoload unless modelsMax is one', () => {
  expect(
    sanitizeLlamaCppServiceConfig({
      modelsMax: '1',
      modelsAutoload: true,
    }),
  ).toEqual({
    modelsMax: '1',
    modelsAutoload: true,
  });

  expect(
    sanitizeLlamaCppServiceConfig({
      modelsMax: '2',
      modelsAutoload: true,
    }),
  ).toEqual({
    modelsMax: '2',
    modelsAutoload: false,
  });

  expect(
    sanitizeLlamaCppServiceConfig({
      modelsAutoload: true,
    }),
  ).toEqual({
    modelsAutoload: false,
  });
});

test('sanitizeLlamaCppServiceConfig maps malformed structured numeric strings to explicit defaults', () => {
  expect(
    sanitizeLlamaCppServiceConfig({
      modelsMax: 'abc',
      timeout: '1.5',
      threadsHttp: 'auto',
      cacheReuse: 'one',
      cacheRam: '8g',
      ctxSize: '4k',
      parallel: 'two',
      batchSize: 'NaN',
      ubatchSize: '--',
      gpuLayers: 'gpu',
      threads: 'fast',
      threadsBatch: 'many',
      mainGpu: 'main',
    }),
  ).toEqual({
    modelsMax: '3',
    timeout: '120',
    threadsHttp: '4',
    cacheReuse: '256',
    cacheRam: '8192',
    ctxSize: '4096',
    parallel: '2',
    batchSize: '512',
    ubatchSize: '512',
    gpuLayers: 'auto',
    threads: '-1',
    threadsBatch: '-1',
    mainGpu: '0',
  });
});

test('sanitizeLlamaCppServiceConfig maps out-of-range numeric values to explicit defaults', () => {
  expect(
    sanitizeLlamaCppServiceConfig({
      modelsMax: '9999999',
      timeout: '9999999',
      threadsHttp: '9999999',
      ctxSize: '9999999',
      parallel: '9999999',
      batchSize: '9999999',
      ubatchSize: '9999999',
      gpuLayers: '9999999',
      threads: '9999999',
      threadsBatch: '9999999',
      mainGpu: '9999999',
      cacheReuse: '9999999',
      cacheRam: '9999999',
    }),
  ).toEqual({
    modelsMax: '3',
    timeout: '120',
    threadsHttp: '4',
    cacheReuse: '256',
    cacheRam: '8192',
    ctxSize: '4096',
    parallel: '2',
    batchSize: '512',
    ubatchSize: '512',
    gpuLayers: 'auto',
    threads: '-1',
    threadsBatch: '-1',
    mainGpu: '0',
  });
});

test('sanitizeLlamaCppServiceConfig drops invalid tensor split values', () => {
  expect(
    sanitizeLlamaCppServiceConfig({
      tensorSplit: '9999',
    }),
  ).toEqual({});

  expect(
    sanitizeLlamaCppServiceConfig({
      splitMode: 'tensor',
      tensorSplit: '按张量拆分',
    }),
  ).toEqual({
    splitMode: 'tensor',
  });

  expect(
    sanitizeLlamaCppServiceConfig({
      splitMode: 'tensor',
      tensorSplit: '3,2',
    }),
  ).toEqual({
    splitMode: 'tensor',
    tensorSplit: '3,2',
  });
});

test('sanitizeLlamaCppServiceConfig drops invalid structured device values', () => {
  expect(
    sanitizeLlamaCppServiceConfig({
      device: '显卡0',
    }),
  ).toEqual({});
});

test('sanitizeLlamaCppServiceConfig drops tensor split when split mode is not tensor', () => {
  expect(
    sanitizeLlamaCppServiceConfig({
      splitMode: 'layer',
      tensorSplit: '3,2',
    }),
  ).toEqual({
    splitMode: 'layer',
  });
});

test('sanitizeLlamaCppServiceConfig drops tensor split when it exceeds available device count', () => {
  expect(
    sanitizeLlamaCppServiceConfig({
      splitMode: 'tensor',
      tensorSplit: '3,2,1',
    }),
  ).toEqual({
    splitMode: 'tensor',
    tensorSplit: '3,2,1',
  });
});
test('sanitizeLlamaCppServiceConfig drops invalid runtime backend fields', () => {
  expect(
    sanitizeLlamaCppServiceConfig({
      runtimeBackend: 'metal' as unknown as LlamaCppRuntimeBackend,
      runtimeCudaMajor: '11' as unknown as LlamaCppRuntimeCudaMajor,
    }),
  ).toEqual({});
});

test('sanitizeLlamaCppServiceConfig treats an empty modelsMax as the default loaded model limit', () => {
  expect(
    sanitizeLlamaCppServiceConfig({
      modelsMax: '',
    }),
  ).toEqual({
    modelsMax: '3',
  });
});

test('sanitizeLlamaCppServiceConfig preserves the local inference persistence setting', () => {
  expect(sanitizeLlamaCppServiceConfig({ keepRunningOnAppQuit: false })).toEqual({
    keepRunningOnAppQuit: false,
  });
});

test('getLlamaCppServiceConfig keeps modelsAutoload unset when the user did not configure it', () => {
  const store = {
    get: () => ({ modelsMax: '1' }),
  } as unknown as Parameters<typeof getLlamaCppServiceConfig>[0];

  expect(getLlamaCppServiceConfig(store)).toEqual({
    host: '127.0.0.1',
    port: '8080',
    modelsMax: '1',
    keepRunningOnAppQuit: true,
    timeout: '120',
    threadsHttp: '4',
    cacheReuse: '256',
    cacheRam: '8192',
    parallel: '2',
    kvUnified: true,
    batchSize: '512',
    ubatchSize: '512',
    gpuLayers: 'auto',
    memoryPolicy: LlamaCppMemoryPolicy.Auto,
    memoryBudgetPercent: 50,
  });
});

test('getLlamaCppLoadedModelLimitViolation blocks loading a third model when modelsMax is two', () => {
  expect(
    getLlamaCppLoadedModelLimitViolation({
      modelsMax: '2',
      runningModels: [{ name: 'Qwen3-0.6B-GGUF' }, { name: 'Qwen3-1.7B-GGUF' }],
      targetModelName: 'Qwen3-4B-GGUF',
    }),
  ).toEqual({
    limit: 2,
    next: 3,
  });
});

test('getLlamaCppLoadedModelLimitViolation allows reloading an already running model', () => {
  expect(
    getLlamaCppLoadedModelLimitViolation({
      modelsMax: '2',
      runningModels: [{ name: 'Qwen3-0.6B-GGUF' }, { name: 'Qwen3-1.7B-GGUF' }],
      targetModelName: 'Qwen3-1.7B-GGUF',
    }),
  ).toBeNull();
});

test('does not refresh model capabilities for manager status events', async () => {
  let statusListener: ((status: unknown) => void) | undefined;
  const listRunningModels = vi.fn(async () => []);
  const client = vi.fn(async () => ({ showModel: vi.fn() }));
  const manager = {
    on: vi.fn((event: string, listener: (value: unknown) => void) => {
      if (event === 'status') statusListener = listener;
      return manager;
    }),
    listRunningModels,
    client,
  } as unknown as LlamaCppManager;
  const store = {
    get: vi.fn(() => undefined),
    set: vi.fn(),
  };

  registerLlamaCppIpcHandlers(manager, {
    getStore: () => store as never,
  });

  expect(statusListener).toBeDefined();
  statusListener?.({ status: 'running' });
  await Promise.resolve();

  expect(listRunningModels).not.toHaveBeenCalled();
  expect(client).not.toHaveBeenCalled();
});

test('retries startup binding synchronization until an automatically loaded model is available', async () => {
  const refresh = vi
    .fn<() => Promise<boolean>>()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  const wait = vi.fn(async () => undefined);

  await waitForLlamaCppStartupModelBindings({
    refresh,
    isCurrent: () => true,
    attempts: 4,
    intervalMs: 1,
    wait,
  });

  expect(refresh).toHaveBeenCalledTimes(3);
  expect(wait).toHaveBeenCalledTimes(2);
});

test('stops startup binding synchronization after the service transition is superseded', async () => {
  const refresh = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
  const wait = vi.fn(async () => undefined);

  await waitForLlamaCppStartupModelBindings({
    refresh,
    isCurrent: () => false,
    attempts: 4,
    intervalMs: 1,
    wait,
  });

  expect(refresh).not.toHaveBeenCalled();
  expect(wait).not.toHaveBeenCalled();
});

test('synchronizes running models and notifies renderers after service startup', async () => {
  electronMocks.handlers.clear();
  electronMocks.windows.length = 0;
  const send = vi.fn();
  electronMocks.windows.push({ isDestroyed: () => false, webContents: { send } });
  const manager = {
    on: vi.fn(() => manager),
    start: vi.fn(async () => ({ status: 'running', checkedAt: new Date(0).toISOString() })),
    listRunningModels: vi.fn(async () => [
      { name: 'qwen-local', status: 'loaded', runtime_context_length: 8192 },
    ]),
    client: vi.fn(async () => ({ showModel: vi.fn(async () => ({})) })),
  } as unknown as LlamaCppManager;
  const store = {
    get: vi.fn(() => undefined),
    set: vi.fn(),
  };

  registerLlamaCppIpcHandlers(manager, {
    getStore: () => store as never,
  });

  const startHandler = electronMocks.handlers.get(LlamaCppIpcChannel.Start);
  if (!startHandler) throw new Error('The local inference start handler was not registered.');

  await expect(Promise.resolve(startHandler())).resolves.toMatchObject({ status: 'running' });
  expect(store.set).toHaveBeenCalledWith(
    'app_config',
    expect.objectContaining({
      providers: expect.objectContaining({
        llamacpp: expect.objectContaining({
          models: [expect.objectContaining({ id: 'qwen-local', contextWindow: 8192 })],
        }),
      }),
    }),
  );
  expect(send).toHaveBeenCalledWith(LlamaCppIpcChannel.ModelBindingsChanged, undefined);
});

test('synchronizes current running models when model bindings are refreshed', async () => {
  electronMocks.handlers.clear();
  const manager = {
    on: vi.fn(() => manager),
    listRunningModels: vi.fn(async () => [
      { name: 'qwen-local', status: 'loaded', runtime_context_length: 8192 },
    ]),
    client: vi.fn(async () => ({ showModel: vi.fn(async () => ({})) })),
  } as unknown as LlamaCppManager;
  const store = {
    get: vi.fn(() => undefined),
    set: vi.fn(),
  };

  registerLlamaCppIpcHandlers(manager, {
    getStore: () => store as never,
  });

  const refreshHandler = electronMocks.handlers.get(LlamaCppIpcChannel.RefreshRunningModelBindings);
  if (!refreshHandler) throw new Error('The local model refresh handler was not registered.');

  await expect(Promise.resolve(refreshHandler())).resolves.toBeUndefined();
  expect(store.set).toHaveBeenCalledWith(
    'app_config',
    expect.objectContaining({
      providers: expect.objectContaining({
        llamacpp: expect.objectContaining({
          models: [expect.objectContaining({ id: 'qwen-local', contextWindow: 8192 })],
        }),
      }),
    }),
  );
});

test('preserves model bindings when the running-model query temporarily fails', async () => {
  electronMocks.handlers.clear();
  electronMocks.windows.length = 0;
  const manager = {
    on: vi.fn(() => manager),
    start: vi.fn(async () => ({ status: 'running', checkedAt: new Date(0).toISOString() })),
    listRunningModels: vi.fn(async () => {
      throw new Error('temporary connection failure');
    }),
  } as unknown as LlamaCppManager;
  const store = {
    get: vi.fn(() => ({ providers: { llamacpp: { models: [{ id: 'qwen-local' }] } } })),
    set: vi.fn(),
  };

  registerLlamaCppIpcHandlers(manager, {
    getStore: () => store as never,
  });

  const startHandler = electronMocks.handlers.get(LlamaCppIpcChannel.Start);
  if (!startHandler) throw new Error('The local inference start handler was not registered.');

  await expect(Promise.resolve(startHandler())).resolves.toMatchObject({ status: 'running' });
  expect(store.set).not.toHaveBeenCalledWith('app_config', expect.anything());
});

test('waits for runtime install cleanup before confirming cancellation', async () => {
  electronMocks.handlers.clear();
  let resolveInstall: ((value: { success: false; cancelled: true }) => void) | undefined;
  let aborted = false;
  const manager = {} as LlamaCppManager;
  Object.assign(manager, {
    on: vi.fn(() => manager),
    installRuntime: vi.fn(({ signal }: { signal: AbortSignal }) =>
      new Promise<{ success: false; cancelled: true }>(resolve => {
        resolveInstall = resolve;
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
          },
          { once: true },
        );
      }),
    ),
  });
  const store = {
    get: vi.fn(() => undefined),
    set: vi.fn(),
  };

  registerLlamaCppIpcHandlers(manager, {
    getStore: () => store as never,
  });

  const installHandler = electronMocks.handlers.get(LlamaCppIpcChannel.Install);
  const cancelHandler = electronMocks.handlers.get(LlamaCppIpcChannel.CancelRuntimeInstall);
  const snapshotHandler = electronMocks.handlers.get(LlamaCppIpcChannel.GetRuntimeInstallSnapshot);
  if (!installHandler || !cancelHandler || !snapshotHandler) {
    throw new Error('Runtime install IPC handlers were not registered.');
  }

  const install = Promise.resolve(installHandler());
  await Promise.resolve();
  await expect(Promise.resolve(snapshotHandler())).resolves.toEqual({ active: true });
  let cancelSettled = false;
  const cancel = Promise.resolve(cancelHandler()).then(result => {
    cancelSettled = true;
    return result;
  });
  await Promise.resolve();

  expect(aborted).toBe(true);
  expect(cancelSettled).toBe(false);

  resolveInstall?.({ success: false, cancelled: true });

  await expect(cancel).resolves.toEqual({ success: true, cancelled: true });
  await expect(install).resolves.toEqual({ success: false, cancelled: true });
  await expect(Promise.resolve(snapshotHandler())).resolves.toEqual({ active: false });
});

test('computes total free VRAM from nvidia-smi snapshots', () => {
  expect(
    getTotalFreeVramMiB({
      source: 'nvidia-smi',
      available: true,
      checkedAt: '2026-05-20T00:00:00.000Z',
      gpus: [
        { index: 0, name: 'GPU 0', memoryTotalMiB: 8192, memoryFreeMiB: 1024 },
        { index: 1, name: 'GPU 1', memoryTotalMiB: 8192, memoryFreeMiB: 2048 },
      ],
    }),
  ).toBe(3072);
});

test('uses a bounded VRAM recovery threshold for unload confirmation', () => {
  expect(getRequiredVramRecoveryMiB(256 * 1024 * 1024)).toBe(64);
  expect(getRequiredVramRecoveryMiB(4 * 1024 * 1024 * 1024)).toBe(512);
});

test('detects when VRAM has recovered enough after unload', () => {
  const beforeSnapshot = {
    source: 'nvidia-smi' as const,
    available: true,
    checkedAt: '2026-05-20T00:00:00.000Z',
    gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: 8192, memoryFreeMiB: 1024 }],
  };

  expect(
    hasRecoveredVram({
      beforeSnapshot,
      currentSnapshot: {
        ...beforeSnapshot,
        checkedAt: '2026-05-20T00:00:01.000Z',
        gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: 8192, memoryFreeMiB: 1180 }],
      },
      sizeVramBytes: 512 * 1024 * 1024,
    }),
  ).toBe(true);

  expect(
    hasRecoveredVram({
      beforeSnapshot,
      currentSnapshot: {
        ...beforeSnapshot,
        checkedAt: '2026-05-20T00:00:01.000Z',
        gpus: [{ index: 0, name: 'GPU 0', memoryTotalMiB: 8192, memoryFreeMiB: 1050 }],
      },
      sizeVramBytes: 512 * 1024 * 1024,
    }),
  ).toBe(false);
});

test('confirms model unload after consecutive missing polls', async () => {
  const polls = [[{ name: 'model-a' }], [], []];
  let index = 0;

  await expect(
    waitForLlamaCppModelUnloadConfirmation({
      modelName: 'model-a',
      listRunningModels: async () => polls[Math.min(index++, polls.length - 1)],
      timeoutMs: 50,
      intervalMs: 0,
      stableMissingPolls: 2,
    }),
  ).resolves.toEqual({
    confirmed: true,
    runningModels: [],
  });
});

test('returns the last running-model snapshot when unload confirmation times out', async () => {
  const runningModels = [{ name: 'model-a' }];

  await expect(
    waitForLlamaCppModelUnloadConfirmation({
      modelName: 'model-a',
      listRunningModels: async () => runningModels,
      timeoutMs: 0,
      intervalMs: 0,
      stableMissingPolls: 2,
    }),
  ).resolves.toEqual({
    confirmed: false,
    runningModels,
  });
});
