import { BrowserWindow, dialog, ipcMain } from 'electron';

import type { NvidiaSmiSnapshot } from '../../shared/hardware';
import type {
  LlamaCppChatChunk,
  LlamaCppChatPayload,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModelLaunchInput,
  LlamaCppModelUnloadResult,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import {
  getLlamaCppLaunchContextLimitViolation,
  LlamaCppIpcChannel,
  LlamaCppRuntimeBackend,
  LlamaCppRuntimeCudaMajor,
} from '../../shared/llamacpp';
import { t } from '../i18n';
import { updateLlamaCppRunningModels } from '../libs/claudeSettings';
import { LlamaCppManager, resolveLlamaCppDeviceSelection } from '../libs/llamacppManager';
import {
  buildLlamaCppOpenClawAppConfig,
  buildLlamaCppRunningModelBinding,
  type LlamaCppOpenClawAppConfig,
  removeLlamaCppModelFromAppConfig,
} from '../libs/llamacppOpenClawBinding';
import { getNvidiaSmiSnapshot } from '../libs/nvidiaSmi';
import type { SqliteStore } from '../sqliteStore';

const LLAMACPP_SERVICE_CONFIG_KEY = 'llamacpp_service_config';
const OLLAMA_SERVICE_CONFIG_KEY = 'ollama_service_config';
const DEFAULT_LLAMACPP_SERVICE_CONFIG: LlamaCppServiceConfig = {};
const LLAMACPP_SANITIZED_NUMERIC_DEFAULTS = {
  modelsMax: '0',
  timeout: '600',
  threadsHttp: '4',
  cacheReuse: '0',
  cacheRam: '8192',
  ctxSize: '4096',
  parallel: '1',
  batchSize: '2048',
  ubatchSize: '512',
  gpuLayers: 'auto',
  threads: '-1',
  threadsBatch: '-1',
  mainGpu: '0',
} as const;
const LLAMACPP_UNLOAD_VRAM_POLL_TIMEOUT_MS = 5_000;
const LLAMACPP_UNLOAD_VRAM_POLL_INTERVAL_MS = 250;
const LLAMACPP_UNLOAD_CONFIRM_TIMEOUT_MS = 8_000;
const LLAMACPP_UNLOAD_CONFIRM_POLL_INTERVAL_MS = 400;
const LLAMACPP_UNLOAD_CONFIRM_STABLE_MISSING_POLLS = 2;

export function shouldSyncOpenClawAfterRunningModelRefresh(reason: string): boolean {
  return reason === 'llamacpp-model-stopped' || reason === 'llamacpp-set-openclaw-model';
}

export function getTotalFreeVramMiB(snapshot: NvidiaSmiSnapshot | null | undefined): number | null {
  if (!snapshot?.available || snapshot.gpus.length === 0) return null;
  const values = snapshot.gpus
    .map(gpu => gpu.memoryFreeMiB)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function getRequiredVramRecoveryMiB(sizeVramBytes?: number): number | null {
  if (!Number.isFinite(sizeVramBytes) || !sizeVramBytes || sizeVramBytes <= 0) return null;
  const sizeVramMiB = sizeVramBytes / (1024 * 1024);
  return Math.max(64, Math.min(512, Math.round(sizeVramMiB * 0.25)));
}

export function hasRecoveredVram(input: {
  beforeSnapshot: NvidiaSmiSnapshot | null | undefined;
  currentSnapshot: NvidiaSmiSnapshot | null | undefined;
  sizeVramBytes?: number;
}): boolean {
  const beforeFreeMiB = getTotalFreeVramMiB(input.beforeSnapshot);
  const currentFreeMiB = getTotalFreeVramMiB(input.currentSnapshot);
  const requiredRecoveryMiB = getRequiredVramRecoveryMiB(input.sizeVramBytes);
  if (beforeFreeMiB === null || currentFreeMiB === null || requiredRecoveryMiB === null) {
    return false;
  }
  return currentFreeMiB - beforeFreeMiB >= requiredRecoveryMiB;
}

function matchesRunningModelName(
  model: { name?: string; model?: string; id?: string },
  modelName: string,
): boolean {
  return model.name === modelName || model.model === modelName || model.id === modelName;
}

export async function waitForLlamaCppModelUnloadConfirmation(input: {
  modelName: string;
  listRunningModels: () => Promise<Awaited<ReturnType<LlamaCppManager['listRunningModels']>>>;
  timeoutMs?: number;
  intervalMs?: number;
  stableMissingPolls?: number;
}): Promise<{
  confirmed: boolean;
  runningModels: Awaited<ReturnType<LlamaCppManager['listRunningModels']>>;
}> {
  const timeoutMs = input.timeoutMs ?? LLAMACPP_UNLOAD_CONFIRM_TIMEOUT_MS;
  const intervalMs = input.intervalMs ?? LLAMACPP_UNLOAD_CONFIRM_POLL_INTERVAL_MS;
  const stableMissingPolls = Math.max(
    1,
    input.stableMissingPolls ?? LLAMACPP_UNLOAD_CONFIRM_STABLE_MISSING_POLLS,
  );
  const deadline = Date.now() + timeoutMs;
  let latestRunningModels = await input.listRunningModels();
  let missingPolls = latestRunningModels.some(model =>
    matchesRunningModelName(model, input.modelName),
  )
    ? 0
    : 1;

  if (missingPolls >= stableMissingPolls) {
    return { confirmed: true, runningModels: latestRunningModels };
  }

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    latestRunningModels = await input.listRunningModels();
    if (latestRunningModels.some(model => matchesRunningModelName(model, input.modelName))) {
      missingPolls = 0;
      continue;
    }
    missingPolls += 1;
    if (missingPolls >= stableMissingPolls) {
      return { confirmed: true, runningModels: latestRunningModels };
    }
  }

  return {
    confirmed: false,
    runningModels: latestRunningModels,
  };
}

export function registerLlamaCppIpcHandlers(
  manager: LlamaCppManager,
  options: {
    getStore: () => SqliteStore;
    syncOpenClawConfig: (options: {
      reason: string;
      restartGatewayIfRunning?: boolean;
      forceGatewayRestartIfRunning?: boolean;
    }) => Promise<{ success: boolean; error?: string }>;
    getAgentManager?: () => {
      getDefaultAgent: () => { id: string } | null;
      updateAgent: (agentId: string, updates: { model?: string }) => unknown;
    };
  },
): void {
  const updateRunningModelBindings = async (
    runningModels: Awaited<ReturnType<LlamaCppManager['listRunningModels']>>,
    reason: string,
  ): Promise<void> => {
    const changed = updateLlamaCppRunningModels(
      runningModels
        .map(model => buildLlamaCppRunningModelBinding(model))
        .filter((model): model is NonNullable<typeof model> => Boolean(model)),
    );
    if (changed && shouldSyncOpenClawAfterRunningModelRefresh(reason)) {
      await options.syncOpenClawConfig({
        reason,
        restartGatewayIfRunning: true,
        forceGatewayRestartIfRunning: true,
      });
    }
  };

  const refreshRunningModelBindings = async (
    reason = 'llamacpp-model-visibility-refresh',
  ): Promise<void> => {
    try {
      await updateRunningModelBindings(await manager.listRunningModels(), reason);
    } catch {
      await updateRunningModelBindings([], reason);
    }
  };

  const broadcast = (channel: string, payload: unknown): void => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (win.isDestroyed()) return;
      win.webContents.send(channel, payload);
    });
  };
  const sendStatus = (status: LlamaCppStatusSnapshot) =>
    broadcast(LlamaCppIpcChannel.StatusChanged, status);
  const sendProgress = (progress: LlamaCppInstallProgress) =>
    broadcast(LlamaCppIpcChannel.InstallProgress, progress);

  migrateLegacyLlamaCppConfig(options.getStore());
  manager.on('status', status => {
    sendStatus(status);
    if (status.status === 'running') {
      void refreshRunningModelBindings('llamacpp-model-launched');
      return;
    }
    if (
      status.status === 'stopped' ||
      status.status === 'error' ||
      status.status === 'not-installed' ||
      status.status === 'installed'
    ) {
      void refreshRunningModelBindings('llamacpp-model-stopped');
    }
  });
  manager.on('install-progress', sendProgress);
  const activeInstalls = new Map<string, AbortController>();
  const activeChats = new Map<string, AbortController>();

  ipcMain.handle(LlamaCppIpcChannel.Status, async () => manager.detect());
  ipcMain.handle(LlamaCppIpcChannel.Install, async () => {
    return await manager.installRuntime();
  });
  ipcMain.handle(LlamaCppIpcChannel.UninstallRuntime, async () => manager.uninstallRuntime());
  ipcMain.handle(LlamaCppIpcChannel.ListRuntimeDevices, async () => manager.listRuntimeDevices());
  ipcMain.handle(LlamaCppIpcChannel.ImportRuntime, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) {
      return { success: false, error: '没有活动窗口' };
    }

    const executableName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const result = await dialog.showOpenDialog(win, {
      title: t('localInferenceImportRuntimeDialogTitle'),
      message: t('localInferenceImportRuntimeDialogMessage').replace('{name}', executableName),
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: '已取消' };
    }

    return await manager.importRuntime(result.filePaths[0]);
  });
  ipcMain.handle(LlamaCppIpcChannel.Start, async () => manager.start());
  ipcMain.handle(LlamaCppIpcChannel.Stop, async () => manager.stop());
  ipcMain.handle(LlamaCppIpcChannel.Restart, async () => manager.restart());
  ipcMain.handle(LlamaCppIpcChannel.GetServiceConfig, async () =>
    getLlamaCppServiceConfig(options.getStore()),
  );
  ipcMain.handle(
    LlamaCppIpcChannel.SetServiceConfig,
    async (_event, config: LlamaCppServiceConfig) => {
      const sanitized = sanitizeLlamaCppServiceConfig(
        config,
        await manager.listRuntimeDevices().catch((): null => null),
      );
      options.getStore().set(LLAMACPP_SERVICE_CONFIG_KEY, sanitized);
      return sanitized;
    },
  );
  ipcMain.handle(LlamaCppIpcChannel.ModelsDir, async () => manager.getModelsDir());

  ipcMain.handle(LlamaCppIpcChannel.ListLocalModels, async () => {
    return await manager.listLocalModels();
  });
  ipcMain.handle(LlamaCppIpcChannel.ListRunningModels, async () => {
    const runningModels = await manager.listRunningModels();
    await updateRunningModelBindings(runningModels, 'llamacpp-model-visibility-refresh');
    return runningModels;
  });
  ipcMain.handle(LlamaCppIpcChannel.DeleteModel, async (_event, name: string) => {
    const result = await manager.deleteModel(name);
    if (!result.success || !result.deleted || !result.removedModelName) {
      return result;
    }

    const store = options.getStore();
    const current = store.get<LlamaCppOpenClawAppConfig>('app_config');
    if (!current) return result;

    const next = removeLlamaCppModelFromAppConfig(current, result.removedModelName);
    store.set('app_config', next.config);
    await refreshRunningModelBindings();

    return {
      ...result,
      clearedDefaultModel: next.clearedDefaultModel,
    };
  });
  ipcMain.handle(LlamaCppIpcChannel.ShowModel, async (_event, name: string) => {
    const client = await manager.client();
    return await client.showModel(name);
  });
  ipcMain.handle(LlamaCppIpcChannel.LoadModel, async (_event, input: LlamaCppModelLaunchInput) => {
    const modelName = input.model.trim();
    if (!modelName) throw new Error('Model name is required');
    const localModels = await manager.listLocalModels();
    const targetModel = localModels.find(
      model => model.name === modelName || model.id === modelName,
    );
    const contextLimitViolation = getLlamaCppLaunchContextLimitViolation({
      requestedContextLength: input.options?.ctxSize,
      trainedContextLength:
        targetModel?.trained_context_length ?? targetModel?.details?.context_length,
    });
    if (contextLimitViolation) {
      throw new Error(
        t('llamacppLaunchContextExceedsTrainingLimit')
          .replace('{requested}', String(contextLimitViolation.requestedContextLength))
          .replace('{trained}', String(contextLimitViolation.trainedContextLength)),
      );
    }
    const result = await manager.loadModel({ ...input, model: modelName });
    await refreshRunningModelBindings();
    return result;
  });
  ipcMain.handle(LlamaCppIpcChannel.UnloadModel, async (_event, name: string) => {
    const modelName = name.trim();
    if (!modelName) throw new Error('Model name is required');
    const beforeRunningModels = await manager.listRunningModels();
    const unloadingModel = beforeRunningModels.find(
      model => model.name === modelName || model.model === modelName || model.id === modelName,
    );
    const beforeSnapshot = unloadingModel?.size_vram ? await getNvidiaSmiSnapshot() : null;
    const client = await manager.client();
    await client.unloadModel(modelName);
    const confirmation = await waitForLlamaCppModelUnloadConfirmation({
      modelName,
      listRunningModels: () => manager.listRunningModels(),
    });
    await updateRunningModelBindings(
      confirmation.runningModels,
      confirmation.confirmed ? 'llamacpp-model-unloaded' : 'llamacpp-model-visibility-refresh',
    );
    const result: LlamaCppModelUnloadResult = {
      success: true,
      confirmed: confirmation.confirmed,
      runningModels: confirmation.runningModels,
    };
    if (!confirmation.confirmed) {
      result.warning = t('llamacppUnloadConfirmationPending');
    }
    if (unloadingModel?.size_vram && beforeSnapshot?.available) {
      const deadline = Date.now() + LLAMACPP_UNLOAD_VRAM_POLL_TIMEOUT_MS;
      let recovered = false;
      while (Date.now() < deadline) {
        const currentSnapshot = await getNvidiaSmiSnapshot();
        if (
          hasRecoveredVram({
            beforeSnapshot,
            currentSnapshot,
            sizeVramBytes: unloadingModel.size_vram,
          })
        ) {
          recovered = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, LLAMACPP_UNLOAD_VRAM_POLL_INTERVAL_MS));
      }
      if (!recovered && confirmation.confirmed) {
        result.warning = t('llamacppUnloadVramRecoveryPending');
      }
    }
    return result;
  });
  ipcMain.handle(
    LlamaCppIpcChannel.InstallModel,
    async (_event, input: LlamaCppInstallModelInput) => {
      const modelId = input.modelId.trim();
      if (!modelId) throw new Error('Model ID is required');
      if (activeInstalls.size > 0) {
        throw new Error('Another model install is already in progress');
      }
      const controller = new AbortController();
      activeInstalls.set(modelId, controller);
      try {
        await manager.installModel(
          input,
          progress => {
            broadcast(LlamaCppIpcChannel.InstallProgress, progress);
          },
          { signal: controller.signal },
        );
        return { success: true };
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          broadcast(LlamaCppIpcChannel.InstallProgress, {
            modelId,
            modelName: input.displayName ?? modelId,
            phase: 'cancelled',
          });
          return { success: false, cancelled: true };
        }
        broadcast(LlamaCppIpcChannel.InstallProgress, {
          modelId,
          modelName: input.displayName ?? modelId,
          phase: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        activeInstalls.delete(modelId);
      }
    },
  );
  ipcMain.handle(LlamaCppIpcChannel.CancelInstall, async (_event, modelId: string) => {
    const normalizedModelId = modelId.trim();
    const controller = activeInstalls.get(normalizedModelId);
    if (!controller) return { success: true, cancelled: false };
    // Let installModel's catch block broadcast the 'cancelled' phase
    // on abort — no need to send 'cancelling' first, which would cause
    // a double broadcast (cancelling → cancelled) and an extra
    // terminal-phase callback in the renderer.
    controller.abort(new Error('Install cancelled'));
    return { success: true, cancelled: true };
  });
  ipcMain.handle(LlamaCppIpcChannel.Chat, async (_event, payload: LlamaCppChatPayload) => {
    const client = await manager.client();
    return await client.chat({ ...payload, stream: false });
  });
  ipcMain.handle(
    LlamaCppIpcChannel.ChatStream,
    async (_event, requestId: string, payload: LlamaCppChatPayload) => {
      if (typeof requestId !== 'string' || !requestId.trim())
        throw new Error('Request ID is required');
      if (activeChats.has(requestId))
        throw new Error(`Chat stream already in progress: ${requestId}`);
      const controller = new AbortController();
      activeChats.set(requestId, controller);
      const client = await manager.client();
      let lastChunk: LlamaCppChatChunk | null = null;
      try {
        await client.chat(
          { ...payload, stream: true },
          chunk => {
            lastChunk = chunk;
            broadcast(LlamaCppIpcChannel.ChatStreamChunk, { requestId, chunk });
          },
          { signal: controller.signal },
        );
        return { success: true, finalChunk: lastChunk };
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          throw new Error('Generation cancelled', { cause: error });
        }
        throw error;
      } finally {
        activeChats.delete(requestId);
      }
    },
  );
  ipcMain.handle(LlamaCppIpcChannel.CancelChatStream, async (_event, requestId: string) => {
    const controller = activeChats.get(requestId);
    if (!controller) return { success: true, cancelled: false };
    controller.abort(new Error('Generation cancelled'));
    return { success: true, cancelled: true };
  });
  ipcMain.handle(LlamaCppIpcChannel.SetOpenClawModel, async (_event, modelName: string) => {
    const normalizedModelName = modelName.trim();
    if (!normalizedModelName) {
      throw new Error('Model name is required');
    }
    const current = options.getStore().get<LlamaCppOpenClawAppConfig>('app_config') ?? {};
    const next = buildLlamaCppOpenClawAppConfig(current, normalizedModelName);
    const openClawModelRef = `llamacpp/${normalizedModelName}`;
    options.getStore().set('app_config', next);
    const defaultAgent = (() => {
      try {
        const agentManager = options.getAgentManager?.();
        const agent = agentManager?.getDefaultAgent?.();
        if (!agent) return null;
        return agentManager.updateAgent(agent.id, { model: openClawModelRef });
      } catch (error) {
        console.warn('[LlamaCpp] failed to update the default OpenClaw agent model:', error);
        return null;
      }
    })();
    await refreshRunningModelBindings('llamacpp-set-openclaw-model');
    const syncResult = await options.syncOpenClawConfig({
      reason: 'llamacpp-local-model-selected',
    });
    return {
      success: syncResult.success,
      error: syncResult.error,
      config: next,
      modelRef: openClawModelRef,
      defaultAgent,
    };
  });
}

export function getLlamaCppServiceConfig(store: SqliteStore): LlamaCppServiceConfig {
  return sanitizeLlamaCppServiceConfig(
    store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY) ??
      DEFAULT_LLAMACPP_SERVICE_CONFIG,
  );
}

function migrateLegacyLlamaCppConfig(store: SqliteStore): void {
  migrateLegacyServiceConfig(store);
}

function migrateLegacyServiceConfig(store: SqliteStore): void {
  const existing = store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY);
  if (existing) return;
  const legacy = store.get<{ cudaVisibleDevices?: string; numParallel?: string }>(
    OLLAMA_SERVICE_CONFIG_KEY,
  );
  if (!legacy) return;
  store.set(
    LLAMACPP_SERVICE_CONFIG_KEY,
    sanitizeLlamaCppServiceConfig({
      device: legacy.cudaVisibleDevices,
    }),
  );
}

export function sanitizeLlamaCppServiceConfig(
  config: LlamaCppServiceConfig | undefined,
  runtimeDevices?: {
    success: boolean;
    devices?: Array<{ id?: string; name?: string }>;
  } | null,
): LlamaCppServiceConfig {
  const next: LlamaCppServiceConfig = {};
  const host = config?.host?.trim();
  const port = normalizeIntegerString(config?.port);
  const modelsDir = config?.modelsDir?.trim();
  const customExecutablePath = config?.customExecutablePath?.trim();
  const runtimeBackend = config?.runtimeBackend;
  const runtimeCudaMajor = config?.runtimeCudaMajor;
  const modelsMax = normalizeIntegerStringWithDefault(config?.modelsMax, {
    min: 0,
    max: 256,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.modelsMax,
  });
  const modelsAutoload = config?.modelsAutoload as unknown;
  const timeout = normalizeIntegerStringWithDefault(config?.timeout, {
    min: 1,
    max: 86_400,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.timeout,
  });
  const threadsHttp = normalizeSignedIntegerStringWithDefault(config?.threadsHttp, {
    min: 1,
    max: 512,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.threadsHttp,
  });
  const cacheReuse = normalizeIntegerStringWithDefault(config?.cacheReuse, {
    min: 0,
    max: 65_536,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.cacheReuse,
  });
  const cacheRam = normalizeSignedIntegerStringWithDefault(config?.cacheRam, {
    min: 0,
    max: 1_048_576,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.cacheRam,
  });
  const ctxCheckpoints = normalizeIntegerString(config?.ctxCheckpoints);
  const checkpointEveryNt = normalizeSignedIntegerString(config?.checkpointEveryNt);
  const ctxSize = normalizeIntegerStringWithDefault(config?.ctxSize, {
    min: 128,
    max: 1_048_576,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.ctxSize,
  });
  const parallel = normalizeSignedIntegerStringWithDefault(config?.parallel, {
    min: 0,
    max: 256,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.parallel,
  });
  const batchSize = normalizeIntegerStringWithDefault(config?.batchSize, {
    min: 1,
    max: 65_536,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.batchSize,
  });
  const ubatchSize = normalizeIntegerStringWithDefault(config?.ubatchSize, {
    min: 1,
    max: 65_536,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.ubatchSize,
  });
  const gpuLayers = normalizeGpuLayersStringWithDefault(config?.gpuLayers, {
    min: 0,
    max: 4_096,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.gpuLayers,
  });
  const threads = normalizeSignedIntegerStringWithDefault(config?.threads, {
    min: -1,
    max: 512,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.threads,
  });
  const threadsBatch = normalizeSignedIntegerStringWithDefault(config?.threadsBatch, {
    min: -1,
    max: 512,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.threadsBatch,
  });
  const device = normalizeVisibleDevices(config?.device, runtimeDevices);
  const splitMode = isSplitMode(config?.splitMode) ? config.splitMode : undefined;
  const mainGpu = normalizeIntegerStringWithDefault(config?.mainGpu, {
    min: 0,
    max: 64,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.mainGpu,
  });
  const tensorSplit = normalizeTensorSplit(config?.tensorSplit, {
    splitMode,
    runtimeDevices,
  });
  const reasoningBudget = normalizeSignedIntegerString(config?.reasoningBudget);

  if (host) next.host = host;
  if (port) next.port = port;
  if (modelsDir) next.modelsDir = modelsDir;
  if (customExecutablePath) next.customExecutablePath = customExecutablePath;
  if (isRuntimeBackend(runtimeBackend)) next.runtimeBackend = runtimeBackend;
  if (isRuntimeCudaMajor(runtimeCudaMajor)) next.runtimeCudaMajor = runtimeCudaMajor;
  if (modelsMax) next.modelsMax = modelsMax;
  if (typeof modelsAutoload === 'boolean') next.modelsAutoload = modelsAutoload;
  if (modelsAutoload === 'true') next.modelsAutoload = true;
  if (modelsAutoload === 'false') next.modelsAutoload = false;
  if (timeout) next.timeout = timeout;
  if (threadsHttp) next.threadsHttp = threadsHttp;
  if (typeof config?.cachePrompt === 'boolean') next.cachePrompt = config.cachePrompt;
  if (cacheReuse) next.cacheReuse = cacheReuse;
  if (cacheRam) next.cacheRam = cacheRam;
  if (ctxCheckpoints) next.ctxCheckpoints = ctxCheckpoints;
  if (checkpointEveryNt) next.checkpointEveryNt = checkpointEveryNt;
  if (ctxSize) next.ctxSize = ctxSize;
  if (parallel) next.parallel = parallel;
  if (batchSize) next.batchSize = batchSize;
  if (ubatchSize) next.ubatchSize = ubatchSize;
  if (gpuLayers) next.gpuLayers = gpuLayers;
  if (threads) next.threads = threads;
  if (threadsBatch) next.threadsBatch = threadsBatch;
  if (device) next.device = device;
  if (mainGpu) next.mainGpu = mainGpu;
  if (splitMode) next.splitMode = splitMode;
  if (tensorSplit) next.tensorSplit = tensorSplit;
  if (isOnOffAuto(config?.flashAttn)) next.flashAttn = config.flashAttn;
  if (isOnOffAuto(config?.jinja)) next.jinja = config.jinja;
  if (isOnOffAuto(config?.reasoning)) next.reasoning = config.reasoning;
  if (isReasoningFormat(config?.reasoningFormat)) next.reasoningFormat = config.reasoningFormat;
  if (reasoningBudget) next.reasoningBudget = reasoningBudget;
  if (config?.reasoningBudgetMessage?.trim())
    next.reasoningBudgetMessage = config.reasoningBudgetMessage.trim();
  if (config?.chatTemplate?.trim()) next.chatTemplate = config.chatTemplate.trim();
  if (config?.chatTemplateFile?.trim()) next.chatTemplateFile = config.chatTemplateFile.trim();
  if (typeof config?.skipChatParsing === 'boolean') next.skipChatParsing = config.skipChatParsing;
  if (typeof config?.prefillAssistant === 'boolean')
    next.prefillAssistant = config.prefillAssistant;
  if (typeof config?.noMmap === 'boolean') next.noMmap = config.noMmap;
  if (typeof config?.mlock === 'boolean') next.mlock = config.mlock;
  return next;
}

function normalizeIntegerString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeIntegerStringWithDefault(
  value: string | undefined,
  range: { min: number; max: number; defaultValue: string },
): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === '' && range.min === 0) return range.defaultValue;
  const normalized = normalizeIntegerString(value);
  if (!normalized) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return range.defaultValue;
  if (parsed < range.min || parsed > range.max) return range.defaultValue;
  return normalized;
}

function normalizeSignedIntegerString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeSignedIntegerStringWithDefault(
  value: string | undefined,
  range: { min: number; max: number; defaultValue: string },
): string | undefined {
  const normalized = normalizeSignedIntegerString(value);
  if (!normalized) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return range.defaultValue;
  if (parsed < range.min || parsed > range.max) return range.defaultValue;
  return normalized;
}

function normalizeGpuLayersString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'auto' || trimmed === 'all') return trimmed;
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeGpuLayersStringWithDefault(
  value: string | undefined,
  range: { min: number; max: number; defaultValue: string },
): string | undefined {
  const normalized = normalizeGpuLayersString(value);
  if (!normalized) return undefined;
  if (normalized === 'auto' || normalized === 'all') return normalized;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return range.defaultValue;
  if (parsed < range.min || parsed > range.max) return range.defaultValue;
  return normalized;
}

function normalizeVisibleDevices(
  value: string | undefined,
  runtimeDevices?: {
    success: boolean;
    devices?: Array<{ id?: string; name?: string; backend?: string }>;
  } | null,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  if (!runtimeDevices?.success || !Array.isArray(runtimeDevices.devices) || runtimeDevices.devices.length === 0) {
    const tokens = trimmed
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
    if (tokens.length === 0) return undefined;

    const normalizedTokens = tokens.map(token => /^[A-Za-z0-9_.:-]+$/.test(token) ? token : '');
    if (normalizedTokens.some(token => !token)) {
      return undefined;
    }
    return normalizedTokens.join(',');
  }

  const runtimeDeviceList = runtimeDevices.devices.flatMap(device => {
    if (
      typeof device.id !== 'string' ||
      device.id.trim().length === 0
    ) {
      return [];
    }
    return [{
      id: device.id.trim(),
      name:
        typeof device.name === 'string' && device.name.trim().length > 0
          ? device.name.trim()
          : device.id.trim(),
      backend:
        typeof device.backend === 'string' && device.backend.trim().length > 0
          ? device.backend.trim()
          : 'unknown',
    }];
  });
  if (runtimeDeviceList.length === 0) {
    return undefined;
  }

  const resolved = resolveLlamaCppDeviceSelection(trimmed, runtimeDeviceList);
  return resolved || undefined;
}

function normalizeTensorSplit(
  value: string | undefined,
  options?: {
    splitMode?: NonNullable<LlamaCppServiceConfig['splitMode']>;
    runtimeDevices?: {
      success: boolean;
      devices?: Array<{ id?: string; name?: string }>;
    } | null;
  },
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (options?.splitMode !== 'tensor') return undefined;

  const parts = trimmed
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  const normalizedParts: string[] = [];
  for (const part of parts) {
    if (!/^\d+(?:\.\d+)?$/.test(part)) {
      return undefined;
    }
    const parsed = Number(part);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1024) {
      return undefined;
    }
    normalizedParts.push(Number.isInteger(parsed) ? String(parsed) : String(parsed));
  }

  if (
    options?.runtimeDevices?.success &&
    Array.isArray(options.runtimeDevices.devices) &&
    options.runtimeDevices.devices.length > 0 &&
    normalizedParts.length > options.runtimeDevices.devices.length
  ) {
    return undefined;
  }

  return normalizedParts.join(',');
}

function isSplitMode(value: unknown): value is NonNullable<LlamaCppServiceConfig['splitMode']> {
  return value === 'none' || value === 'layer' || value === 'row' || value === 'tensor';
}

function isOnOffAuto(value: unknown): value is 'on' | 'off' | 'auto' {
  return value === 'on' || value === 'off' || value === 'auto';
}

function isRuntimeBackend(value: unknown): value is NonNullable<LlamaCppServiceConfig['runtimeBackend']> {
  return (
    value === LlamaCppRuntimeBackend.Auto ||
    value === LlamaCppRuntimeBackend.Cpu ||
    value === LlamaCppRuntimeBackend.Cuda
  );
}

function isRuntimeCudaMajor(
  value: unknown,
): value is NonNullable<LlamaCppServiceConfig['runtimeCudaMajor']> {
  return value === LlamaCppRuntimeCudaMajor.Cuda12;
}

function isReasoningFormat(
  value: unknown,
): value is NonNullable<LlamaCppServiceConfig['reasoningFormat']> {
  return (
    value === 'none' || value === 'deepseek' || value === 'deepseek-legacy' || value === 'auto'
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
