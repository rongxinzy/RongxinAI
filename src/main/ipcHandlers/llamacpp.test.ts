import { expect, test, vi } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  LlamaCppIpcChannel,
  LlamaCppRuntimeBackend,
  LlamaCppRuntimeCudaMajor,
  LlamaCppMemoryPolicy,
  LlamaCppModelResidencyMode,
  LlamaCppOrchestrator,
  type LlamaCppServiceConfig,
} from '../../shared/llamacpp';
import { ModelCapabilityStatus } from '../../shared/providers';
import type { LlamaCppManager } from '../libs/llamacppManager';
import { LlamaCppModelDaemonController } from '../libs/llamacppModelDaemonController';
import { LlamaCppRouterOrchestrator } from '../libs/llamacppRouterOrchestrator';
import {
  applyStoredModelPreferencesToLaunchInput,
  enforceLlamaCppParallelTwo,
  getLlamaCppLoadedModelLimitViolation,
  getLlamaCppServiceConfig,
  getRequiredVramRecoveryMiB,
  getTotalFreeVramMiB,
  hasRecoveredVram,
  sanitizeLlamaCppServiceConfig,
  sanitizeLlamaCppModelPreference,
  shouldRefreshLlamaCppModelBindings,
  waitForLlamaCppModelUnloadConfirmation,
  waitForLlamaCppStartupModelBindings,
  registerLlamaCppIpcHandlers,
} from './llamacpp';
import { LLAMACPP_MODEL_PREFERENCES_KEY, LLAMACPP_SERVICE_CONFIG_KEY } from './llamacpp/config';

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

test('sanitizeLlamaCppModelPreference retains a timed residency policy', () => {
  expect(
    sanitizeLlamaCppModelPreference({
      residency: { mode: LlamaCppModelResidencyMode.Timed, idleMinutes: 30 },
    }),
  ).toEqual({
    residency: { mode: LlamaCppModelResidencyMode.Timed, idleMinutes: 30 },
  });
});

test('sanitizeLlamaCppModelPreference accepts a non-negative integer MoE CPU layer count', () => {
  expect(sanitizeLlamaCppModelPreference({ nCpuMoe: 0 })).toEqual({
    nCpuMoe: 0,
  });
  expect(sanitizeLlamaCppModelPreference({ ctxSize: 8192, nCpuMoe: 12 })).toEqual({
    ctxSize: 8192,
    nCpuMoe: 12,
  });
});

test('sanitizeLlamaCppModelPreference drops invalid MoE CPU layer counts', () => {
  expect(sanitizeLlamaCppModelPreference({ nCpuMoe: -1 })).toBeNull();
  expect(sanitizeLlamaCppModelPreference({ nCpuMoe: 1.5 })).toBeNull();
  expect(sanitizeLlamaCppModelPreference({ nCpuMoe: '12' })).toBeNull();
});

test('applyStoredModelPreferencesToLaunchInput applies ctxSize and nCpuMoe independently', () => {
  const preferences = {
    'qwen3-30b-a3b': { ctxSize: 16384, nCpuMoe: 12 },
    dense: { ctxSize: 4096 },
  };
  const store = {
    get: <T>(key: string) =>
      key === 'llamacpp_model_preferences' ? (preferences as T) : undefined,
  } as unknown as Parameters<typeof applyStoredModelPreferencesToLaunchInput>[0];

  expect(applyStoredModelPreferencesToLaunchInput(store, { model: 'qwen3-30b-a3b' })).toEqual({
    model: 'qwen3-30b-a3b',
    options: { ctxSize: 16384, nCpuMoe: 12 },
  });
  // Explicit launch ctxSize wins, nCpuMoe still applies.
  expect(
    applyStoredModelPreferencesToLaunchInput(store, {
      model: 'qwen3-30b-a3b',
      options: { ctxSize: 8192 },
    }),
  ).toEqual({
    model: 'qwen3-30b-a3b',
    options: { ctxSize: 8192, nCpuMoe: 12 },
  });
  // Explicit launch nCpuMoe wins, ctxSize still applies.
  expect(
    applyStoredModelPreferencesToLaunchInput(store, {
      model: 'qwen3-30b-a3b',
      options: { nCpuMoe: 0 },
    }),
  ).toEqual({
    model: 'qwen3-30b-a3b',
    options: { ctxSize: 16384, nCpuMoe: 0 },
  });
  // Dense model without nCpuMoe: no n-cpu-moe emitted.
  expect(applyStoredModelPreferencesToLaunchInput(store, { model: 'dense' })).toEqual({
    model: 'dense',
    options: { ctxSize: 4096 },
  });
});

test('does not refresh model bindings when only residency changes', () => {
  expect(
    shouldRefreshLlamaCppModelBindings(
      { residency: { mode: LlamaCppModelResidencyMode.Timed, idleMinutes: 30 } },
      { residency: { mode: LlamaCppModelResidencyMode.Timed, idleMinutes: 60 } },
    ),
  ).toBe(false);
});

test('refreshes model bindings when a binding field changes', () => {
  expect(
    shouldRefreshLlamaCppModelBindings(
      { ctxSize: 8192, capabilities: { toolCalling: ModelCapabilityStatus.Unsupported } },
      { ctxSize: 16_384, capabilities: { toolCalling: ModelCapabilityStatus.Supported } },
    ),
  ).toBe(true);
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

test.each([
  { mode: LlamaCppOrchestrator.Router, outcome: 'stopped' },
  { mode: LlamaCppOrchestrator.Daemon, outcome: 'stopped' },
  { mode: LlamaCppOrchestrator.Router, outcome: 'running' },
  { mode: LlamaCppOrchestrator.Daemon, outcome: 'running' },
  { mode: LlamaCppOrchestrator.Router, outcome: 'running through full service config' },
  { mode: LlamaCppOrchestrator.Router, outcome: 'failed restart' },
  { mode: LlamaCppOrchestrator.Router, outcome: 'invalid directory' },
])('sets the model directory with the $mode orchestrator ($outcome)', async ({ mode, outcome }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'zhiyuan-model-directory-'));
  const originalDir = path.join(root, 'old');
  const nextDir = path.join(root, 'new');
  let config: LlamaCppServiceConfig = { orchestrator: mode, modelsDir: originalDir, parallel: '2' };
  const store = {
    get: vi.fn((key: string) => (key === LLAMACPP_SERVICE_CONFIG_KEY ? config : undefined)),
    set: vi.fn((_key: string, value: LlamaCppServiceConfig) => {
      config = value;
    }),
  };
  const wasRunning = outcome !== 'stopped';
  const invalidDirectory = outcome === 'invalid directory';
  const oldStart = vi.fn(async () => ({ status: 'running' }));
  const oldStop = vi.fn(async () => ({ status: 'stopped' }));
  const clearLastLoadedModel = vi.fn();
  const manager = {
    on: vi.fn(),
    getModelsDir: () => config.modelsDir,
    getStatus: () => ({ status: !wasRunning || invalidDirectory ? 'running' : 'stopped' }),
    start: oldStart,
    stop: oldStop,
    clearPersistedLastLoadedModel: clearLastLoadedModel,
  } as unknown as LlamaCppManager;
  const prototype =
    mode === LlamaCppOrchestrator.Router
      ? LlamaCppRouterOrchestrator.prototype
      : LlamaCppModelDaemonController.prototype;
  const gatewayUrl = 'http://127.0.0.1:8080';
  const status = { status: 'running', checkedAt: new Date(0).toISOString() } as const;
  let model = wasRunning ? { name: 'old-model', runtime_context_length: 8192 } : null;
  const reconnect = vi
    .spyOn(prototype, 'reconnect')
    .mockImplementation(async () =>
      model
        ? { status, runningModels: [model], modelProcesses: [], gatewayBaseUrl: gatewayUrl }
        : null,
    );
  const list = vi
    .spyOn(prototype, 'listRunningModels')
    .mockImplementation(async () => (model ? [model] : []));
  const restart = vi.spyOn(prototype, 'restart').mockImplementation(async nextConfig => {
    expect(config.modelsDir).toBe(nextDir);
    expect(nextConfig.modelsDir).toBe(nextDir);
    model = null;
    if (outcome === 'failed restart') throw new Error('fixture restart failure');
    model = { name: 'new-model', runtime_context_length: 16384 };
    return status;
  });
  const leftover =
    mode === LlamaCppOrchestrator.Router
      ? vi.spyOn(LlamaCppModelDaemonController.prototype, 'reconnect').mockResolvedValue(null)
      : undefined;
  const onModelBindingsChanged = vi.fn();
  try {
    registerLlamaCppIpcHandlers(manager, {
      getStore: () => store as never,
      onModelBindingsChanged,
    });
    // Separate registration's reconnect from the user's directory change.
    await new Promise<void>(resolve => setImmediate(resolve));
    onModelBindingsChanged.mockClear();
    list.mockClear();

    const fullConfig = outcome === 'running through full service config';
    if (invalidDirectory) await writeFile(nextDir, 'A file occupies the destination.');
    const change = electronMocks.handlers.get(
      fullConfig ? LlamaCppIpcChannel.SetServiceConfig : LlamaCppIpcChannel.SetModelsDir,
    )!;
    const result = change(
      {},
      fullConfig ? { ...config, modelsDir: ` ${nextDir} ` } : ` ${nextDir} `,
    );
    if (invalidDirectory || outcome === 'failed restart') {
      await expect(result).rejects.toThrow(
        invalidDirectory ? /EEXIST|ENOTDIR/ : 'fixture restart failure',
      );
      expect(config.modelsDir).toBe(originalDir);
    } else {
      if (fullConfig) await expect(result).resolves.toMatchObject({ modelsDir: nextDir });
      else await expect(result).resolves.toBe(nextDir);
      expect((await stat(nextDir)).isDirectory()).toBe(true);
    }
    expect(restart).toHaveBeenCalledTimes(wasRunning && !invalidDirectory ? 1 : 0);
    expect(oldStart).not.toHaveBeenCalled();
    expect(oldStop).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    if (invalidDirectory) {
      expect(clearLastLoadedModel).not.toHaveBeenCalled();
      expect(onModelBindingsChanged).not.toHaveBeenCalled();
    } else if (outcome === 'running' || fullConfig) {
      expect(onModelBindingsChanged).toHaveBeenLastCalledWith(gatewayUrl, [
        expect.objectContaining({ id: 'new-model' }),
      ]);
    } else {
      expect(onModelBindingsChanged).toHaveBeenLastCalledWith(null, []);
    }
  } finally {
    reconnect.mockRestore();
    list.mockRestore();
    restart.mockRestore();
    leftover?.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

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

test('llama.cpp startup ignores the retired Ollama configuration', async () => {
  const daemonReconnect = vi
    .spyOn(LlamaCppModelDaemonController.prototype, 'reconnect')
    .mockResolvedValue(null);
  const routerReconnect = vi
    .spyOn(LlamaCppRouterOrchestrator.prototype, 'reconnect')
    .mockResolvedValue(null);
  const listRunning = vi
    .spyOn(LlamaCppRouterOrchestrator.prototype, 'listRunningModels')
    .mockResolvedValue([]);
  const retiredConfigKey = 'ollama_service_config';
  const store = {
    get: vi.fn((key: string) =>
      key === retiredConfigKey ? { cudaVisibleDevices: '7' } : undefined,
    ),
    set: vi.fn(),
  };
  const manager = { getModelsDir: () => '/tmp/models', on: vi.fn() };

  try {
    registerLlamaCppIpcHandlers(manager as unknown as LlamaCppManager, {
      getStore: () => store as never,
    });
    await vi.waitFor(() => expect(routerReconnect).toHaveBeenCalledOnce());

    expect(listRunning).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalledWith(retiredConfigKey);
    expect(store.set).not.toHaveBeenCalledWith(LLAMACPP_SERVICE_CONFIG_KEY, expect.anything());
  } finally {
    daemonReconnect.mockRestore();
    routerReconnect.mockRestore();
    listRunning.mockRestore();
  }
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
    orchestrator: LlamaCppOrchestrator.Router,
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
    orchestrator: LlamaCppOrchestrator.Router,
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

test('keeps a stopped daemon idle during registration, status and model listing', async () => {
  const reconnect = vi
    .spyOn(LlamaCppModelDaemonController.prototype, 'reconnect')
    .mockResolvedValue(null);
  const daemonListRunningModels = vi
    .spyOn(LlamaCppModelDaemonController.prototype, 'listRunningModels')
    .mockResolvedValue([]);
  const start = vi.spyOn(LlamaCppModelDaemonController.prototype, 'start').mockResolvedValue({
    status: 'running',
    checkedAt: new Date(0).toISOString(),
  });
  const manager = {
    on: vi.fn(() => manager),
    getModelsDir: vi.fn(() => '/tmp/models'),
  } as unknown as LlamaCppManager;
  const store = {
    get: vi.fn(() => ({ orchestrator: LlamaCppOrchestrator.Daemon, parallel: '2' })),
    set: vi.fn(),
  };

  registerLlamaCppIpcHandlers(manager, {
    getStore: () => store as never,
  });

  await vi.waitFor(() => expect(reconnect).toHaveBeenCalledOnce());

  expect(manager.on).toHaveBeenCalledWith('install-progress', expect.any(Function));
  expect(manager.on).not.toHaveBeenCalledWith('status', expect.any(Function));

  const status = electronMocks.handlers.get(LlamaCppIpcChannel.Status)!;
  const listRunning = electronMocks.handlers.get(LlamaCppIpcChannel.ListRunningModels)!;
  await expect(status({})).resolves.toMatchObject({ status: 'stopped' });
  await expect(listRunning({})).resolves.toEqual([]);
  expect(start).not.toHaveBeenCalled();
  expect(daemonListRunningModels).not.toHaveBeenCalled();
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

const runningModelSnapshot = {
  status: { status: 'running', managedByApp: true, checkedAt: new Date(0).toISOString() },
  runningModels: [{ name: 'qwen-local', status: 'loaded', runtime_context_length: 8192 }],
  modelProcesses: [],
  gatewayBaseUrl: 'http://127.0.0.1:8080',
} satisfies Awaited<ReturnType<LlamaCppModelDaemonController['reconnect']>>;

test('synchronizes running models and notifies renderers after service startup', async () => {
  electronMocks.handlers.clear();
  electronMocks.windows.length = 0;
  const send = vi.fn();
  electronMocks.windows.push({ isDestroyed: () => false, webContents: { send } });
  const manager = {
    on: vi.fn(() => manager),
    getModelsDir: vi.fn(() => '/tmp/models'),
  } as unknown as LlamaCppManager;
  const store = {
    get: vi.fn(() => ({ orchestrator: LlamaCppOrchestrator.Daemon })),
    set: vi.fn(),
  };
  const onModelBindingsChanged = vi.fn();
  const reconnect = vi
    .spyOn(LlamaCppModelDaemonController.prototype, 'reconnect')
    .mockResolvedValue(null);
  const start = vi
    .spyOn(LlamaCppModelDaemonController.prototype, 'start')
    .mockImplementation(async () => {
      reconnect.mockResolvedValue(runningModelSnapshot);
      return runningModelSnapshot.status;
    });

  registerLlamaCppIpcHandlers(manager, {
    getStore: () => store as never,
    onModelBindingsChanged,
  });

  const startHandler = electronMocks.handlers.get(LlamaCppIpcChannel.Start);
  if (!startHandler) throw new Error('The local inference start handler was not registered.');

  await expect(Promise.resolve(startHandler())).resolves.toMatchObject({ status: 'running' });
  expect(start).toHaveBeenCalledOnce();
  expect(onModelBindingsChanged).toHaveBeenCalledWith('http://127.0.0.1:8080', [
    expect.objectContaining({ id: 'qwen-local', contextWindow: 8192 }),
  ]);
  expect(store.set).not.toHaveBeenCalledWith('app_config', expect.anything());
  expect(send).toHaveBeenCalledWith(LlamaCppIpcChannel.ModelBindingsChanged, undefined);
});

test('reads running bindings with stored limits and no unused model metadata requests', async () => {
  electronMocks.handlers.clear();
  const manager = {
    on: vi.fn(() => manager),
    getModelsDir: vi.fn(() => '/tmp/models'),
    listRunningModels: vi.fn(async () => [
      { name: 'qwen-local', status: 'loaded', runtime_context_length: 8192 },
    ]),
    client: vi.fn(async () => ({ showModel: vi.fn(async () => ({})) })),
  } as unknown as LlamaCppManager;
  const store = {
    get: vi.fn((key: string) =>
      key === LLAMACPP_MODEL_PREFERENCES_KEY
        ? { 'qwen-local': { ctxSize: 32768, maxTokens: 1536 } }
        : { orchestrator: LlamaCppOrchestrator.Daemon },
    ),
    set: vi.fn(),
  };
  const reconnect = vi
    .spyOn(LlamaCppModelDaemonController.prototype, 'reconnect')
    .mockResolvedValue(null);

  const inference = registerLlamaCppIpcHandlers(manager, {
    getStore: () => store as never,
  });
  await vi.waitFor(() => expect(reconnect).toHaveBeenCalled());
  reconnect.mockResolvedValue(runningModelSnapshot);

  const { baseUrl, models } = await inference.readModelBindings();
  expect(baseUrl).toBe('http://127.0.0.1:8080');
  expect(models[0]).toMatchObject({ id: 'qwen-local', contextWindow: 8192, maxTokens: 1536 });
  expect(manager.client).not.toHaveBeenCalled();
  expect(store.set).not.toHaveBeenCalledWith('app_config', expect.anything());
});

test('clears published bindings after a failed passive refresh without changing stored models', async () => {
  electronMocks.handlers.clear();
  electronMocks.windows.length = 0;
  const manager = {
    on: vi.fn(() => manager),
    getModelsDir: vi.fn(() => '/tmp/models'),
  } as unknown as LlamaCppManager;
  const store = {
    get: vi.fn(() => ({
      orchestrator: LlamaCppOrchestrator.Daemon,
      providers: { llamacpp: { models: [{ id: 'qwen-local' }] } },
    })),
    set: vi.fn(),
  };
  const reconnect = vi
    .spyOn(LlamaCppModelDaemonController.prototype, 'reconnect')
    .mockResolvedValue(runningModelSnapshot);
  const onModelBindingsChanged = vi.fn();

  registerLlamaCppIpcHandlers(manager, {
    getStore: () => store as never,
    onModelBindingsChanged,
  });
  await vi.waitFor(() => expect(onModelBindingsChanged).toHaveBeenCalled());
  onModelBindingsChanged.mockClear();
  reconnect.mockRejectedValue(new Error('temporary connection failure'));

  const setPreference = electronMocks.handlers.get(LlamaCppIpcChannel.SetModelPreference)!;
  await setPreference({}, { modelName: 'qwen-local', preference: { maxTokens: 1536 } });
  expect(onModelBindingsChanged).toHaveBeenCalledWith(null, []);
  expect(store.set).not.toHaveBeenCalledWith('app_config', expect.anything());
});

test('waits for runtime install cleanup before confirming cancellation', async () => {
  electronMocks.handlers.clear();
  let resolveInstall: ((value: { success: false; cancelled: true }) => void) | undefined;
  let aborted = false;
  const manager = {} as LlamaCppManager;
  Object.assign(manager, {
    on: vi.fn(() => manager),
    getModelsDir: vi.fn(() => '/tmp/models'),
    installRuntime: vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
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
    get: vi.fn(() => ({ orchestrator: 'daemon' })),
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
