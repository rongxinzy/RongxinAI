import { BrowserWindow, ipcMain } from 'electron';

import type {
  LlamaCppChatPayload,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModelLaunchInput,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { LlamaCppIpcChannel } from '../../shared/llamacpp';
import { updateLlamaCppRunningModels } from '../libs/claudeSettings';
import { LlamaCppManager } from '../libs/llamacppManager';
import { type LlamaCppOpenClawAppConfig, removeLlamaCppModelFromAppConfig } from '../libs/llamacppOpenClawBinding';
import type { SqliteStore } from '../sqliteStore';

const LLAMACPP_SERVICE_CONFIG_KEY = 'llamacpp_service_config';
const OLLAMA_SERVICE_CONFIG_KEY = 'ollama_service_config';
const DEFAULT_LLAMACPP_SERVICE_CONFIG: LlamaCppServiceConfig = {};

export function registerLlamaCppIpcHandlers(
  manager: LlamaCppManager,
  options: {
    getStore: () => SqliteStore;
    syncOpenClawConfig: (options: { reason: string; restartGatewayIfRunning?: boolean; forceGatewayRestartIfRunning?: boolean }) => Promise<{ success: boolean; error?: string }>;
    getAgentManager?: () => {
      getDefaultAgent: () => { id: string } | null;
      updateAgent: (agentId: string, updates: { model?: string }) => unknown;
    };
  },
): void {
  const refreshRunningModelBindings = async (reason: string): Promise<void> => {
    try {
      const client = await manager.client();
      const runningModels = await client.runningModels();
      const changed = updateLlamaCppRunningModels(
        runningModels.map((model) => ({
          id: model.name?.trim() || model.model?.trim() || model.id?.trim() || '',
          name: model.name?.trim() || model.model?.trim() || model.id?.trim() || '',
          supportsImage: false,
        })).filter((model) => model.id),
      );
      if (changed) {
        await options.syncOpenClawConfig({
          reason,
          restartGatewayIfRunning: true,
          forceGatewayRestartIfRunning: true,
        });
      }
    } catch {
      const changed = updateLlamaCppRunningModels([]);
      if (changed) {
        await options.syncOpenClawConfig({
          reason,
          restartGatewayIfRunning: true,
          forceGatewayRestartIfRunning: true,
        });
      }
    }
  };

  const broadcast = (channel: string, payload: unknown): void => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.isDestroyed()) return;
      win.webContents.send(channel, payload);
    });
  };
  const sendStatus = (status: LlamaCppStatusSnapshot) => broadcast(LlamaCppIpcChannel.StatusChanged, status);
  const sendProgress = (progress: LlamaCppInstallProgress) => broadcast(LlamaCppIpcChannel.InstallProgress, progress);

  migrateLegacyLlamaCppConfig(options.getStore());
  manager.on('status', (status) => {
    sendStatus(status);
    if (status.status === 'running') {
      void refreshRunningModelBindings('llamacpp-status-running');
      return;
    }
    if (status.status === 'stopped' || status.status === 'error' || status.status === 'not-installed' || status.status === 'installed') {
      void refreshRunningModelBindings('llamacpp-status-not-running');
    }
  });
  manager.on('install-progress', sendProgress);
  const activeInstalls = new Map<string, AbortController>();
  const activeChats = new Map<string, AbortController>();

  ipcMain.handle(LlamaCppIpcChannel.Status, async () => manager.detect());
  ipcMain.handle(LlamaCppIpcChannel.Install, async () => {
    return await manager.installRuntime();
  });
  ipcMain.handle(LlamaCppIpcChannel.Start, async () => manager.start());
  ipcMain.handle(LlamaCppIpcChannel.Stop, async () => manager.stop());
  ipcMain.handle(LlamaCppIpcChannel.Restart, async () => manager.restart());
  ipcMain.handle(LlamaCppIpcChannel.GetServiceConfig, async () => getLlamaCppServiceConfig(options.getStore()));
  ipcMain.handle(LlamaCppIpcChannel.SetServiceConfig, async (_event, config: LlamaCppServiceConfig) => {
    const sanitized = sanitizeLlamaCppServiceConfig(config);
    options.getStore().set(LLAMACPP_SERVICE_CONFIG_KEY, sanitized);
    return sanitized;
  });
  ipcMain.handle(LlamaCppIpcChannel.ModelsDir, async () => manager.getModelsDir());

  ipcMain.handle(LlamaCppIpcChannel.ListLocalModels, async () => {
    return await manager.listLocalModels();
  });
  ipcMain.handle(LlamaCppIpcChannel.ListRunningModels, async () => {
    const client = await manager.client();
    const runningModels = await client.runningModels();
    updateLlamaCppRunningModels(
      runningModels.map((model) => ({
        id: model.name?.trim() || model.model?.trim() || model.id?.trim() || '',
        name: model.name?.trim() || model.model?.trim() || model.id?.trim() || '',
        supportsImage: false,
      })).filter((model) => model.id),
    );
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
    await refreshRunningModelBindings('llamacpp-model-deleted');

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
    const result = await manager.loadModel({ ...input, model: modelName });
    await refreshRunningModelBindings('llamacpp-model-loaded');
    return result;
  });
  ipcMain.handle(LlamaCppIpcChannel.UnloadModel, async (_event, name: string) => {
    const modelName = name.trim();
    if (!modelName) throw new Error('Model name is required');
    const client = await manager.client();
    await client.unloadModel(modelName);
    const runningModels = await client.runningModels();
    await refreshRunningModelBindings('llamacpp-model-unloaded');
    return { success: true, runningModels };
  });
  ipcMain.handle(LlamaCppIpcChannel.InstallModel, async (_event, input: LlamaCppInstallModelInput) => {
    const modelId = input.modelId.trim();
    if (!modelId) throw new Error('Model ID is required');
    if (activeInstalls.has(modelId)) {
      throw new Error(`Model install already in progress: ${modelId}`);
    }
    const controller = new AbortController();
    activeInstalls.set(modelId, controller);
    try {
      await manager.installModel(input, (progress) => {
        broadcast(LlamaCppIpcChannel.InstallProgress, progress);
      }, { signal: controller.signal });
      return { success: true };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        broadcast(LlamaCppIpcChannel.InstallProgress, { modelId, modelName: input.displayName ?? modelId, phase: 'cancelled' });
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
  });
  ipcMain.handle(LlamaCppIpcChannel.CancelInstall, async (_event, modelId: string) => {
    const normalizedModelId = modelId.trim();
    const controller = activeInstalls.get(normalizedModelId);
    if (!controller) return { success: true, cancelled: false };
    broadcast(LlamaCppIpcChannel.InstallProgress, { modelId: normalizedModelId, modelName: normalizedModelId, phase: 'cancelling' });
    controller.abort(new Error('Install cancelled'));
    return { success: true, cancelled: true };
  });
  ipcMain.handle(LlamaCppIpcChannel.Chat, async (_event, payload: LlamaCppChatPayload) => {
    const client = await manager.client();
    return await client.chat({ ...payload, stream: false });
  });
  ipcMain.handle(LlamaCppIpcChannel.ChatStream, async (_event, requestId: string, payload: LlamaCppChatPayload) => {
    if (typeof requestId !== 'string' || !requestId.trim()) throw new Error('Request ID is required');
    if (activeChats.has(requestId)) throw new Error(`Chat stream already in progress: ${requestId}`);
    const controller = new AbortController();
    activeChats.set(requestId, controller);
    const client = await manager.client();
    try {
      await client.chat({ ...payload, stream: true }, (chunk) => {
        broadcast(LlamaCppIpcChannel.ChatStreamChunk, { requestId, chunk });
      }, { signal: controller.signal });
      return { success: true };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw new Error('Generation cancelled', { cause: error });
      }
      throw error;
    } finally {
      activeChats.delete(requestId);
    }
  });
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
    const openClawModelRef = `llamacpp/${normalizedModelName}`;
    await refreshRunningModelBindings('llamacpp-model-visibility-refresh');
    return {
      success: true,
      modelRef: openClawModelRef,
    };
  });
}

export function getLlamaCppServiceConfig(store: SqliteStore): LlamaCppServiceConfig {
  return sanitizeLlamaCppServiceConfig(store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY) ?? DEFAULT_LLAMACPP_SERVICE_CONFIG);
}

function migrateLegacyLlamaCppConfig(store: SqliteStore): void {
  migrateLegacyServiceConfig(store);
}

function migrateLegacyServiceConfig(store: SqliteStore): void {
  const existing = store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY);
  if (existing) return;
  const legacy = store.get<{ cudaVisibleDevices?: string; numParallel?: string }>(OLLAMA_SERVICE_CONFIG_KEY);
  if (!legacy) return;
  store.set(LLAMACPP_SERVICE_CONFIG_KEY, sanitizeLlamaCppServiceConfig({
    device: legacy.cudaVisibleDevices,
  }));
}

export function sanitizeLlamaCppServiceConfig(config: LlamaCppServiceConfig | undefined): LlamaCppServiceConfig {
  const next: LlamaCppServiceConfig = {};
  const host = config?.host?.trim();
  const port = normalizeIntegerString(config?.port);
  const modelsDir = config?.modelsDir?.trim();
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
  if (config?.reasoningBudgetMessage?.trim()) next.reasoningBudgetMessage = config.reasoningBudgetMessage.trim();
  if (config?.chatTemplate?.trim()) next.chatTemplate = config.chatTemplate.trim();
  if (config?.chatTemplateFile?.trim()) next.chatTemplateFile = config.chatTemplateFile.trim();
  if (typeof config?.skipChatParsing === 'boolean') next.skipChatParsing = config.skipChatParsing;
  if (typeof config?.prefillAssistant === 'boolean') next.prefillAssistant = config.prefillAssistant;
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

function isReasoningFormat(value: unknown): value is NonNullable<LlamaCppServiceConfig['reasoningFormat']> {
  return value === 'none' || value === 'deepseek' || value === 'deepseek-legacy' || value === 'auto';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
