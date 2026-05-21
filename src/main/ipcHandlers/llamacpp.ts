import { BrowserWindow, ipcMain } from 'electron';

import type { NvidiaSmiSnapshot } from '../../shared/hardware';
import type {
  LlamaCppChatPayload,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModelLaunchInput,
  LlamaCppModelUnloadResult,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { getLlamaCppLaunchContextLimitViolation, LlamaCppIpcChannel } from '../../shared/llamacpp';
import { t } from '../i18n';
import { updateLlamaCppRunningModels } from '../libs/claudeSettings';
import { LlamaCppManager } from '../libs/llamacppManager';
import { getNvidiaSmiSnapshot } from '../libs/nvidiaSmi';
import {
  buildLlamaCppRunningModelBinding,
  buildLlamaCppOpenClawAppConfig,
  type LlamaCppOpenClawAppConfig,
  removeLlamaCppModelFromAppConfig,
} from '../libs/llamacppOpenClawBinding';
import type { SqliteStore } from '../sqliteStore';

const LLAMACPP_SERVICE_CONFIG_KEY = 'llamacpp_service_config';
const OLLAMA_SERVICE_CONFIG_KEY = 'ollama_service_config';
const DEFAULT_LLAMACPP_SERVICE_CONFIG: LlamaCppServiceConfig = {};
const LLAMACPP_UNLOAD_VRAM_POLL_TIMEOUT_MS = 5_000;
const LLAMACPP_UNLOAD_VRAM_POLL_INTERVAL_MS = 250;
const LLAMACPP_UNLOAD_CONFIRM_TIMEOUT_MS = 8_000;
const LLAMACPP_UNLOAD_CONFIRM_POLL_INTERVAL_MS = 400;
const LLAMACPP_UNLOAD_CONFIRM_STABLE_MISSING_POLLS = 2;

export function shouldSyncOpenClawAfterRunningModelRefresh(reason: string): boolean {
  return reason === 'llamacpp-model-visibility-refresh';
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
      void refreshRunningModelBindings();
      return;
    }
    if (
      status.status === 'stopped' ||
      status.status === 'error' ||
      status.status === 'not-installed' ||
      status.status === 'installed'
    ) {
      void refreshRunningModelBindings();
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
  ipcMain.handle(LlamaCppIpcChannel.Start, async () => manager.start());
  ipcMain.handle(LlamaCppIpcChannel.Stop, async () => manager.stop());
  ipcMain.handle(LlamaCppIpcChannel.Restart, async () => manager.restart());
  ipcMain.handle(LlamaCppIpcChannel.GetServiceConfig, async () =>
    getLlamaCppServiceConfig(options.getStore()),
  );
  ipcMain.handle(
    LlamaCppIpcChannel.SetServiceConfig,
    async (_event, config: LlamaCppServiceConfig) => {
      const sanitized = sanitizeLlamaCppServiceConfig(config);
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
      if (activeInstalls.has(modelId)) {
        throw new Error(`Model install already in progress: ${modelId}`);
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
    broadcast(LlamaCppIpcChannel.InstallProgress, {
      modelId: normalizedModelId,
      modelName: normalizedModelId,
      phase: 'cancelling',
    });
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
      try {
        await client.chat(
          { ...payload, stream: true },
          chunk => {
            broadcast(LlamaCppIpcChannel.ChatStreamChunk, { requestId, chunk });
          },
          { signal: controller.signal },
        );
        return { success: true };
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
    await refreshRunningModelBindings();
    const syncResult = await options.syncOpenClawConfig({
      reason: 'llamacpp-local-model-selected',
      restartGatewayIfRunning: false,
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
): LlamaCppServiceConfig {
  const next: LlamaCppServiceConfig = {};
  const host = config?.host?.trim();
  const port = normalizeIntegerString(config?.port);
  const modelsDir = config?.modelsDir?.trim();
  const customExecutablePath = config?.customExecutablePath?.trim();
  const modelsMax = normalizeIntegerString(config?.modelsMax);
  const modelsAutoload = config?.modelsAutoload as unknown;
  const timeout = normalizeIntegerString(config?.timeout);
  const threadsHttp = normalizeSignedIntegerString(config?.threadsHttp);
  const cacheReuse = normalizeIntegerString(config?.cacheReuse);
  const cacheRam = normalizeSignedIntegerString(config?.cacheRam);
  const ctxCheckpoints = normalizeIntegerString(config?.ctxCheckpoints);
  const checkpointEveryNt = normalizeSignedIntegerString(config?.checkpointEveryNt);
  const ctxSize = normalizeIntegerString(config?.ctxSize);
  const parallel = normalizeSignedIntegerString(config?.parallel);
  const batchSize = normalizeIntegerString(config?.batchSize);
  const ubatchSize = normalizeIntegerString(config?.ubatchSize);
  const gpuLayers = normalizeGpuLayersString(config?.gpuLayers);
  const threads = normalizeSignedIntegerString(config?.threads);
  const threadsBatch = normalizeSignedIntegerString(config?.threadsBatch);
  const mainGpu = normalizeIntegerString(config?.mainGpu);
  const reasoningBudget = normalizeSignedIntegerString(config?.reasoningBudget);

  if (host) next.host = host;
  if (port) next.port = port;
  if (modelsDir) next.modelsDir = modelsDir;
  if (customExecutablePath) next.customExecutablePath = customExecutablePath;
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
  if (config?.device?.trim()) next.device = config.device.trim();
  if (mainGpu) next.mainGpu = mainGpu;
  if (isSplitMode(config?.splitMode)) next.splitMode = config.splitMode;
  if (config?.tensorSplit?.trim()) next.tensorSplit = config.tensorSplit.trim();
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

function normalizeSignedIntegerString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeGpuLayersString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'auto' || trimmed === 'all') return trimmed;
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  return trimmed;
}

function isSplitMode(value: unknown): value is NonNullable<LlamaCppServiceConfig['splitMode']> {
  return value === 'none' || value === 'layer' || value === 'row' || value === 'tensor';
}

function isOnOffAuto(value: unknown): value is 'on' | 'off' | 'auto' {
  return value === 'on' || value === 'off' || value === 'auto';
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
