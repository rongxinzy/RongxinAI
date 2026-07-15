import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';

import type { NvidiaSmiSnapshot } from '../../shared/hardware';
import type {
  LlamaCppImportModelFilesResult,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModel,
  LlamaCppModelLaunchLogEvent,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchResult,
  LlamaCppModelPreference,
  LlamaCppModelPreferences,
  LlamaCppModelUnloadResult,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppSetModelPreferenceInput,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import {
  DEFAULT_LLAMACPP_SERVICE_CONFIG,
  getLlamaCppAcceleratorDevices,
  getLlamaCppModelsMaxLimitViolation,
  LLAMACPP_GPU_LAYERS_MAX,
  LLAMACPP_STRUCTURED_INTEGER_RANGES,
  LlamaCppIpcChannel,
  LlamaCppModelLaunchLogPhase,
  LlamaCppRuntimeBackend,
  LlamaCppRuntimeCudaMajor,
  LlamaCppStructuredServiceFieldKey,
} from '../../shared/llamacpp';
import { isProviderEnabled, ProviderName } from '../../shared/providers';
import { t } from '../i18n';
import { updateLlamaCppRunningModels } from '../libs/claudeSettings';
import {
  LlamaCppManager,
  resolveLlamaCppDeviceSelection,
} from '../libs/llamacppManager';
import {
  classifyLlamaCppModelLoadError,
  getLlamaCppModelLoadFailureI18nKey,
  LlamaCppModelLoadFailureReason,
} from '../libs/llamacppModelLoadErrors';
import {
  createLlamaCppModelLaunchLogger,
  createLlamaCppServiceStartupLaunchLogger,
} from '../libs/llamacppModelLaunchLog';
import { LlamaCppModelLoadLock } from '../libs/llamacppModelLoadLock';
import { loadLlamaCppModelThroughPipeline } from '../libs/llamacppModelLoadPipeline';
import {
  buildLlamaCppRunningModelBinding,
  type LlamaCppOpenClawAppConfig,
  removeLlamaCppModelFromAppConfig,
  upsertLlamaCppProviderInAppConfig,
} from '../libs/llamacppOpenClawBinding';
import {
  ensureLlamaCppServiceRunning,
  getLlamaCppServiceStartupFailureI18nKey,
  LlamaCppServiceStartupReason,
} from '../libs/llamacppServiceStartup';
import { applyLlamaCppServiceTransition } from '../libs/llamacppServiceTransition';
import { LlamaCppServiceTransitionLock } from '../libs/llamacppServiceTransitionLock';
import { getNvidiaSmiSnapshot } from '../libs/nvidiaSmi';
import type { SqliteStore } from '../sqliteStore';

const LLAMACPP_SERVICE_CONFIG_KEY = 'llamacpp_service_config';
const OLLAMA_SERVICE_CONFIG_KEY = 'ollama_service_config';
const LLAMACPP_MODEL_PREFERENCES_KEY = 'llamacpp_model_preferences';
const LLAMACPP_UNLOAD_VRAM_POLL_TIMEOUT_MS = 5_000;
const LLAMACPP_UNLOAD_VRAM_POLL_INTERVAL_MS = 250;
const LLAMACPP_UNLOAD_CONFIRM_TIMEOUT_MS = 8_000;
const LLAMACPP_UNLOAD_CONFIRM_POLL_INTERVAL_MS = 400;
const LLAMACPP_UNLOAD_CONFIRM_STABLE_MISSING_POLLS = 2;

const LLAMACPP_SANITIZED_NUMERIC_DEFAULTS = {
  modelsMax: DEFAULT_LLAMACPP_SERVICE_CONFIG.modelsMax ?? '0',
  timeout: DEFAULT_LLAMACPP_SERVICE_CONFIG.timeout ?? '120',
  threadsHttp: DEFAULT_LLAMACPP_SERVICE_CONFIG.threadsHttp ?? '4',
  cacheReuse: DEFAULT_LLAMACPP_SERVICE_CONFIG.cacheReuse ?? '256',
  cacheRam: DEFAULT_LLAMACPP_SERVICE_CONFIG.cacheRam ?? '8192',
  ctxSize: DEFAULT_LLAMACPP_SERVICE_CONFIG.ctxSize ?? '4096',
  parallel: DEFAULT_LLAMACPP_SERVICE_CONFIG.parallel ?? '1',
  batchSize: DEFAULT_LLAMACPP_SERVICE_CONFIG.batchSize ?? '512',
  ubatchSize: DEFAULT_LLAMACPP_SERVICE_CONFIG.ubatchSize ?? '512',
  gpuLayers: DEFAULT_LLAMACPP_SERVICE_CONFIG.gpuLayers ?? 'auto',
  threads: DEFAULT_LLAMACPP_SERVICE_CONFIG.threads ?? '-1',
  threadsBatch: DEFAULT_LLAMACPP_SERVICE_CONFIG.threadsBatch ?? '-1',
  mainGpu: DEFAULT_LLAMACPP_SERVICE_CONFIG.mainGpu ?? '0',
} as const;

export function shouldSyncOpenClawAfterRunningModelRefresh(reason: string): boolean {
  return (
    reason === 'llamacpp-model-loaded'
    || reason === 'llamacpp-model-unloaded'
    || reason === 'llamacpp-model-launched'
    || reason === 'llamacpp-model-stopped'
    || reason === 'llamacpp-model-visibility-refresh'
  );
}

export function shouldSyncOpenClawForRunningModelRefresh(input: {
  reason: string;
  runningModelsChanged: boolean;
  appConfigChanged: boolean;
  appConfig: LlamaCppOpenClawAppConfig;
}): boolean {
  const llamaCppEnabled = isProviderEnabled(
    ProviderName.LlamaCpp,
    input.appConfig.providers?.[ProviderName.LlamaCpp],
  );

  return (
    llamaCppEnabled
    && (input.runningModelsChanged || input.appConfigChanged)
    && shouldSyncOpenClawAfterRunningModelRefresh(input.reason)
  );
}

export function getLlamaCppLoadedModelLimitViolation(input: {
  modelsMax: string | undefined;
  runningModels: Array<{ name?: string; model?: string }>;
  targetModelName: string;
}): { limit: number; next: number } | null {
  return getLlamaCppModelsMaxLimitViolation({
    modelsMax: input.modelsMax,
    targetModelName: input.targetModelName,
    runningModelNames: Array.from(
      new Set(
        input.runningModels
          .map(model => (model.name || model.model || '').trim())
          .filter(Boolean),
      ),
    ),
  });
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

function toUserFacingLlamaCppModelLoadError(error: unknown): Error {
  const reason = classifyLlamaCppModelLoadError(error);
  return new Error(t(getLlamaCppModelLoadFailureI18nKey(reason)));
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
  },
  ): void {
  const updateRunningModelBindings = async (
    runningModels: Awaited<ReturnType<LlamaCppManager['listRunningModels']>>,
    reason: string,
  ): Promise<void> => {
    const bindingModels = runningModels
      .map(model => buildLlamaCppRunningModelBinding(model))
      .filter((model): model is NonNullable<typeof model> => Boolean(model));
    const runningModelsChanged = updateLlamaCppRunningModels(bindingModels);
    const store = options.getStore();
    const current = store.get<LlamaCppOpenClawAppConfig>('app_config') ?? {};
    const appConfigUpdate = upsertLlamaCppProviderInAppConfig(current, bindingModels);
    if (appConfigUpdate.changed) {
      store.set('app_config', appConfigUpdate.config);
    }
    if (shouldSyncOpenClawForRunningModelRefresh({
      reason,
      runningModelsChanged,
      appConfigChanged: appConfigUpdate.changed,
      appConfig: appConfigUpdate.config,
    })) {
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
    if (bindingRefreshSuppressed) return;
    const refreshGeneration = bindingRefreshGeneration;
    try {
      const runningModels = await manager.listRunningModels();
      if (bindingRefreshSuppressed || refreshGeneration !== bindingRefreshGeneration) return;
      await updateRunningModelBindings(runningModels, reason);
    } catch {
      if (bindingRefreshSuppressed || refreshGeneration !== bindingRefreshGeneration) return;
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
  const sendModelLaunchLog = (event: LlamaCppModelLaunchLogEvent) =>
    broadcast(LlamaCppIpcChannel.ModelLaunchLog, event);
  const loadModelLock = new LlamaCppModelLoadLock();
  const serviceTransitionLock = new LlamaCppServiceTransitionLock();
  const runServiceTransition = async <T>(action: () => Promise<T>): Promise<T> =>
    await serviceTransitionLock.runExclusive(
      action,
      () => new Error(t('llamacppLoadModelServiceUnavailable')),
    );
  let bindingRefreshSuppressed = false;
  let bindingRefreshGeneration = 0;

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

  ipcMain.handle(LlamaCppIpcChannel.Status, async () => manager.detect());
  ipcMain.handle(LlamaCppIpcChannel.Install, async () => {
    return await manager.installRuntime();
  });
  ipcMain.handle(LlamaCppIpcChannel.UninstallRuntime, async () => manager.uninstallRuntime());
  ipcMain.handle(LlamaCppIpcChannel.ListRuntimeDevices, async (_event, input: unknown) => {
    const ref = sanitizeLlamaCppBackendRef(input);
    return await manager.listRuntimeDevices(ref ?? undefined);
  });
  ipcMain.handle(LlamaCppIpcChannel.ListBackends, async () => manager.listBackends());
  ipcMain.handle(LlamaCppIpcChannel.GetBackendSelection, async () => manager.getBackendSelection());
  ipcMain.handle(LlamaCppIpcChannel.SetBackendSelection, async (_event, input: unknown) => {
    const ref = sanitizeLlamaCppBackendRef(input);
    if (!ref) {
      return {
        success: false,
        plan: { kind: 'needs-manual', message: 'Invalid llama.cpp backend selection.' },
        error: 'Invalid llama.cpp backend selection.',
      };
    }
    return await manager.setBackendSelection(ref);
  });
  ipcMain.handle(LlamaCppIpcChannel.InstallBackend, async (_event, input: unknown) => {
    const ref = sanitizeLlamaCppBackendRef(input);
    if (!ref) return await manager.installRuntime();
    return await manager.setBackendSelection(ref);
  });
  ipcMain.handle(LlamaCppIpcChannel.UninstallBackend, async (_event, input: unknown) => {
    const ref = sanitizeLlamaCppBackendRef(input);
    if (!ref) return await manager.uninstallRuntime();
    return await manager.uninstallBackend(ref);
  });
  ipcMain.handle(LlamaCppIpcChannel.GetRuntimeCapabilities, async () =>
    manager.getRuntimeCapabilities(),
  );
  ipcMain.handle(LlamaCppIpcChannel.ImportRuntime, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) {
      return { success: false, error: '没有活动窗口' };
    }

    const result = await dialog.showOpenDialog(win, {
      title: t('localInferenceImportRuntimeDialogTitle'),
      message: t('localInferenceImportRuntimeDialogMessage'),
      properties: ['openFile'],
      filters: [
        { name: 'llama.cpp backend archives', extensions: ['zip', 'gz'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: '已取消' };
    }

    return await manager.importRuntime(result.filePaths[0]);
  });
  ipcMain.handle(LlamaCppIpcChannel.Start, async () => manager.start());
  ipcMain.handle(LlamaCppIpcChannel.Stop, async () => manager.stop());
  ipcMain.handle(LlamaCppIpcChannel.Restart, async () => await runServiceTransition(async () => {
    const wasRunning = manager.getStatus().status === 'running';
    const nextStatus = await applyLlamaCppServiceTransition({
      wasRunning,
      stop: () => manager.stop(),
      start: () => manager.start(),
      applyConfig: () => undefined,
      clearLastLoadedModel: () => manager.clearPersistedLastLoadedModel(),
      refreshBindings: () => refreshRunningModelBindings('llamacpp-model-visibility-refresh'),
      setBindingRefreshSuppressed: suppressed => {
        bindingRefreshSuppressed = suppressed;
        if (suppressed) bindingRefreshGeneration += 1;
      },
    });
    return nextStatus ?? manager.getStatus();
  }));
  ipcMain.handle(LlamaCppIpcChannel.GetServiceConfig, async () =>
    getLlamaCppServiceConfig(options.getStore()),
  );
  ipcMain.handle(LlamaCppIpcChannel.SetServiceConfig, async (_event, config: LlamaCppServiceConfig) => {
    const sanitized = sanitizeLlamaCppServiceConfig(config);
    options.getStore().set(LLAMACPP_SERVICE_CONFIG_KEY, sanitized);
    return sanitized;
  });
  ipcMain.handle(LlamaCppIpcChannel.ModelsDir, async () => manager.getModelsDir());
  ipcMain.handle(LlamaCppIpcChannel.SetModelsDir, async (_event, modelsDir: unknown) => await runServiceTransition(async () => {
    const store = options.getStore();
    const currentConfig = store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY) ?? {};
    const trimmedModelsDir = typeof modelsDir === 'string' ? modelsDir.trim() : '';
    const nextConfig = sanitizeLlamaCppServiceConfig({
      ...currentConfig,
      modelsDir: trimmedModelsDir || undefined,
    });
    const modelsDirChanged = (currentConfig.modelsDir?.trim() || '') !== (nextConfig.modelsDir?.trim() || '');
    if (!modelsDirChanged) return manager.getModelsDir();

    const wasRunning = manager.getStatus().status === 'running';
    const nextStatus = await applyLlamaCppServiceTransition({
      wasRunning,
      stop: () => manager.stop(),
      start: () => manager.start(),
      applyConfig: () => {
        if (trimmedModelsDir) {
          fs.mkdirSync(trimmedModelsDir, { recursive: true });
        }
        store.set(LLAMACPP_SERVICE_CONFIG_KEY, nextConfig);
      },
      clearLastLoadedModel: () => manager.clearPersistedLastLoadedModel(),
      refreshBindings: () => refreshRunningModelBindings('llamacpp-model-visibility-refresh'),
      setBindingRefreshSuppressed: suppressed => {
        bindingRefreshSuppressed = suppressed;
        if (suppressed) bindingRefreshGeneration += 1;
      },
    });
    if (wasRunning && nextStatus?.status !== 'running') {
      throw new Error(t('llamacppServiceStartupUnknown'));
    }
    return manager.getModelsDir();
  }));

  ipcMain.handle(LlamaCppIpcChannel.ListLocalModels, async () => {
    return await manager.listLocalModels();
  });
  ipcMain.handle(LlamaCppIpcChannel.ListRunningModels, async () => {
    try {
      const runningModels = await manager.listRunningModels();
      if (!bindingRefreshSuppressed) {
        await updateRunningModelBindings(runningModels, 'llamacpp-model-visibility-refresh');
      }
      return runningModels;
    } catch (error) {
      if (manager.getStatus().status !== 'running') return [];
      throw error;
    }
  });
  ipcMain.handle(LlamaCppIpcChannel.DeleteModel, async (_event, name: string) => {
    const result = await manager.deleteModel(name);
    if (!result.success || !result.deleted || !result.removedModelName) {
      return result;
    }

    const store = options.getStore();
    const modelPreferences = getLlamaCppModelPreferences(store);
    if (modelPreferences[result.removedModelName]) {
      const { [result.removedModelName]: _removedPreference, ...nextPreferences } = modelPreferences;
      store.set(LLAMACPP_MODEL_PREFERENCES_KEY, nextPreferences);
    }
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
  ipcMain.handle(LlamaCppIpcChannel.GetModelPreferences, async () => {
    return getLlamaCppModelPreferences(options.getStore());
  });
  ipcMain.handle(LlamaCppIpcChannel.SetModelPreference, async (_event, input: unknown) => {
    const store = options.getStore();
    const current = getLlamaCppModelPreferences(store);
    const next = sanitizeUpdatedModelPreferences(current, input);
    store.set(LLAMACPP_MODEL_PREFERENCES_KEY, next);
    return next;
  });
  ipcMain.handle(LlamaCppIpcChannel.ImportModelFiles, async (_event, input: unknown) => {
    const paths = Array.isArray(input)
      ? input.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    if (paths.length === 0) {
      const result: LlamaCppImportModelFilesResult = {
        success: true,
        importedModels: [],
        skippedPaths: [],
      };
      return result;
    }
    const importedModels = await manager.importModelFiles(paths);
    const result: LlamaCppImportModelFilesResult = {
      success: true,
      importedModels,
      skippedPaths: paths.filter(filePath => !filePath.trim().toLowerCase().endsWith('.gguf')),
    };
    return result;
  });
  ipcMain.handle(LlamaCppIpcChannel.LoadModel, async (_event, input: LlamaCppModelLaunchInput) => {
    const modelName = input.model.trim();
    const launchLogger = createLlamaCppModelLaunchLogger({
      modelName,
      emit: sendModelLaunchLog,
    });
    launchLogger.info(LlamaCppModelLaunchLogPhase.Requested, undefined, { modelName });
    if (!modelName) {
      launchLogger.error(LlamaCppModelLaunchLogPhase.Failed, undefined, 'Model name is required');
      throw new Error(t(getLlamaCppModelLoadFailureI18nKey(LlamaCppModelLoadFailureReason.ModelNotFound)));
    }
    if (serviceTransitionLock.isActive()) {
      launchLogger.error(LlamaCppModelLaunchLogPhase.Failed, undefined, 'Service transition is active');
      throw new Error(t('llamacppLoadModelServiceUnavailable'));
    }
    return await loadModelLock.runExclusive(
      modelName,
      async () => {
        const store = options.getStore();
        const serviceConfig = getLlamaCppServiceConfig(store);
        const inputWithPreferences = applyStoredModelPreferencesToLaunchInput(store, input);
        launchLogger.info(LlamaCppModelLaunchLogPhase.CheckingService);
        const serviceStartupResult = await ensureLlamaCppServiceRunning(manager, {
          reason: LlamaCppServiceStartupReason.LoadModel,
          logger: createLlamaCppServiceStartupLaunchLogger(launchLogger),
        });
        if (serviceStartupResult.success === false) {
          launchLogger.error(LlamaCppModelLaunchLogPhase.Failed, undefined, {
            code: serviceStartupResult.code,
            detail: serviceStartupResult.detail,
          });
          throw new Error(t(getLlamaCppServiceStartupFailureI18nKey(serviceStartupResult.code)));
        }
        launchLogger.info(LlamaCppModelLaunchLogPhase.ServiceReady, undefined, {
          managedByApp: serviceStartupResult.serviceStatus.managedByApp,
          pid: serviceStartupResult.serviceStatus.pid,
        });

        const runningModels = await manager.listRunningModels();
        const loadLimitViolation = getLlamaCppLoadedModelLimitViolation({
          modelsMax: serviceConfig.modelsMax,
          runningModels,
          targetModelName: modelName,
        });
        if (loadLimitViolation) {
          launchLogger.error(LlamaCppModelLaunchLogPhase.Failed, undefined, loadLimitViolation);
          throw new Error(
            t('llamacppLoadModelLimitReached')
              .replace('{limit}', String(loadLimitViolation.limit))
              .replace('{next}', String(loadLimitViolation.next)),
          );
        }

        const localModels = await manager.listLocalModels();
        const targetModel = localModels.find(
          model => model.name === modelName || model.id === modelName || model.model === modelName,
        );
        launchLogger.info(LlamaCppModelLaunchLogPhase.PreparingModel, undefined, {
          modelFound: Boolean(targetModel),
          modelSizeBytes: targetModel?.size,
          modelPath: targetModel?.path,
        });
        launchLogger.info(LlamaCppModelLaunchLogPhase.CheckingRuntime);
        const runtimeCapabilities = await manager.getRuntimeCapabilities().catch((error): null => {
          launchLogger.warn(LlamaCppModelLaunchLogPhase.CheckingRuntime, undefined, error);
          return null;
        });
        const nvidiaSnapshot = await getNvidiaSmiSnapshot().catch((error): null => {
          launchLogger.warn(LlamaCppModelLaunchLogPhase.CheckingRuntime, undefined, error);
          return null;
        });

        try {
          const result = await loadLlamaCppModelThroughPipeline({
            launchInput: { ...inputWithPreferences, model: modelName },
            runtimeBackend: serviceStartupResult.serviceStatus.runtimeBackend ?? serviceConfig.runtimeBackend,
            runtimeCapabilities,
            nvidiaSnapshot,
            modelSizeBytes: targetModel?.size,
            onLog: launchLogger.report,
            loadModel: async (loadInput: LlamaCppModelLaunchInput): Promise<LlamaCppModelLaunchResult> =>
              manager.loadModel(loadInput),
            listModels: (timeoutMs: number): Promise<LlamaCppModel[]> => manager.listRouterModels(timeoutMs),
            listRunningModels: (): Promise<LlamaCppRunningModel[]> => manager.listRunningModels(),
            detectService: (): Promise<LlamaCppStatusSnapshot> => manager.detect(),
            unloadModel: async unloadModelName => {
              await (await manager.client()).unloadModel(unloadModelName);
            },
          });
          await refreshRunningModelBindings('llamacpp-model-loaded');
          launchLogger.info(LlamaCppModelLaunchLogPhase.Succeeded, undefined, {
            runningModelCount: result.runningModels.length,
          });
          return result;
        } catch (error) {
          launchLogger.error(LlamaCppModelLaunchLogPhase.Failed, undefined, error);
          throw toUserFacingLlamaCppModelLoadError(error);
        }
      },
      () => {
        launchLogger.error(LlamaCppModelLaunchLogPhase.Failed, undefined, 'Another model load is in progress');
        return new Error(t('llamacppModelLoadInProgress'));
      },
    );
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
}

export function getLlamaCppServiceConfig(store: SqliteStore): LlamaCppServiceConfig {
  return sanitizeLlamaCppServiceConfig(
    {
      ...DEFAULT_LLAMACPP_SERVICE_CONFIG,
      ...(store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY) ?? {}),
    },
  );
}

export function getLlamaCppModelPreferences(store: SqliteStore): LlamaCppModelPreferences {
  return sanitizeLlamaCppModelPreferences(
    store.get<LlamaCppModelPreferences>(LLAMACPP_MODEL_PREFERENCES_KEY),
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

function applyStoredModelPreferencesToLaunchInput(
  store: SqliteStore,
  input: LlamaCppModelLaunchInput,
): LlamaCppModelLaunchInput {
  if (input.options?.ctxSize) {
    return input;
  }

  const preference = getLlamaCppModelPreferences(store)[input.model.trim()];
  if (!preference?.ctxSize) {
    return input;
  }

  return {
    ...input,
    options: {
      ...input.options,
      ctxSize: preference.ctxSize,
    },
  };
}

function sanitizeLlamaCppModelPreferences(
  preferences: LlamaCppModelPreferences | undefined,
): LlamaCppModelPreferences {
  if (!preferences || typeof preferences !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(preferences)
      .map(([modelName, preference]) => {
        const normalizedModelName = typeof modelName === 'string' ? modelName.trim() : '';
        if (!normalizedModelName) return null;
        const normalizedPreference = sanitizeLlamaCppModelPreference(preference);
        if (!normalizedPreference) return null;
        return [normalizedModelName, normalizedPreference] as const;
      })
      .filter((entry): entry is readonly [string, LlamaCppModelPreference] => Boolean(entry)),
  );
}

function sanitizeUpdatedModelPreferences(
  current: LlamaCppModelPreferences,
  input: unknown,
): LlamaCppModelPreferences {
  if (!input || typeof input !== 'object') {
    return current;
  }

  const candidate = input as LlamaCppSetModelPreferenceInput;
  const modelName = typeof candidate.modelName === 'string' ? candidate.modelName.trim() : '';
  if (!modelName) {
    return current;
  }

  const normalizedPreference = sanitizeLlamaCppModelPreference(candidate.preference);
  if (!normalizedPreference) {
    const { [modelName]: _removedPreference, ...next } = current;
    return next;
  }

  return {
    ...current,
    [modelName]: normalizedPreference,
  };
}

function sanitizeLlamaCppModelPreference(preference: unknown): LlamaCppModelPreference | null {
  if (!preference || typeof preference !== 'object') {
    return null;
  }

  const candidate = preference as { ctxSize?: unknown };
  const parsedCtxSize =
    typeof candidate.ctxSize === 'number'
      ? candidate.ctxSize
      : typeof candidate.ctxSize === 'string'
        ? Number.parseInt(candidate.ctxSize, 10)
        : undefined;
  const ctxSizeRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CtxSize];

  if (
    typeof parsedCtxSize === 'number' &&
    Number.isFinite(parsedCtxSize) &&
    parsedCtxSize >= ctxSizeRange.min &&
    parsedCtxSize <= ctxSizeRange.max
  ) {
    return { ctxSize: parsedCtxSize };
  }

  return null;
}

export function sanitizeLlamaCppServiceConfig(
  config: LlamaCppServiceConfig | undefined,
  runtimeDevices?: {
    success: boolean;
    devices?: Array<{ id?: string; name?: string }>;
  } | null,
): LlamaCppServiceConfig {
  const next: LlamaCppServiceConfig = {};
  const modelsMaxRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.ModelsMax];
  const timeoutRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.Timeout];
  const threadsHttpRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.ThreadsHttp];
  const cacheReuseRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CacheReuse];
  const cacheRamRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CacheRam];
  const ctxSizeRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CtxSize];
  const parallelRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.Parallel];
  const batchSizeRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.BatchSize];
  const ubatchSizeRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.UbatchSize];
  const threadsRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.Threads];
  const threadsBatchRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.ThreadsBatch];
  const mainGpuRange = LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.MainGpu];
  const host = config?.host?.trim();
  const listenHost = config?.listenHost?.trim();
  const port = normalizeIntegerString(config?.port);
  const modelsDir = config?.modelsDir?.trim();
  const runtimeVersion = config?.runtimeVersion?.trim();
  const runtimeBackend = config?.runtimeBackend;
  const runtimeCudaMajor = config?.runtimeCudaMajor;
  const sanitizedModelsMax = normalizeIntegerStringWithDefault(config?.modelsMax, {
    min: modelsMaxRange.min,
    max: modelsMaxRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.modelsMax,
  });
  const modelsMax = sanitizedModelsMax === '0'
    ? LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.modelsMax
    : sanitizedModelsMax;
  const modelsAutoload = config?.modelsAutoload as unknown;
  const timeout = normalizeIntegerStringWithDefault(config?.timeout, {
    min: timeoutRange.min,
    max: timeoutRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.timeout,
  });
  const threadsHttp = normalizeSignedIntegerStringWithDefault(config?.threadsHttp, {
    min: threadsHttpRange.min,
    max: threadsHttpRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.threadsHttp,
  });
  const cacheReuse = normalizeIntegerStringWithDefault(config?.cacheReuse, {
    min: cacheReuseRange.min,
    max: cacheReuseRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.cacheReuse,
  });
  const cacheRam = normalizeSignedIntegerStringWithDefault(config?.cacheRam, {
    min: cacheRamRange.min,
    max: cacheRamRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.cacheRam,
  });
  const ctxCheckpoints = normalizeIntegerString(config?.ctxCheckpoints);
  const checkpointEveryNt = normalizeSignedIntegerString(config?.checkpointEveryNt);
  const ctxSize = normalizeIntegerStringWithDefault(config?.ctxSize, {
    min: ctxSizeRange.min,
    max: ctxSizeRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.ctxSize,
  });
  const parallel = normalizeSignedIntegerStringWithDefault(config?.parallel, {
    min: parallelRange.min,
    max: parallelRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.parallel,
  });
  const batchSize = normalizeIntegerStringWithDefault(config?.batchSize, {
    min: batchSizeRange.min,
    max: batchSizeRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.batchSize,
  });
  const ubatchSize = normalizeIntegerStringWithDefault(config?.ubatchSize, {
    min: ubatchSizeRange.min,
    max: ubatchSizeRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.ubatchSize,
  });
  const gpuLayers = normalizeGpuLayersStringWithDefault(config?.gpuLayers, {
    min: 0,
    max: LLAMACPP_GPU_LAYERS_MAX,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.gpuLayers,
  });
  const threads = normalizeSignedIntegerStringWithDefault(config?.threads, {
    min: threadsRange.min,
    max: threadsRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.threads,
  });
  const threadsBatch = normalizeSignedIntegerStringWithDefault(config?.threadsBatch, {
    min: threadsBatchRange.min,
    max: threadsBatchRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.threadsBatch,
  });
  const device = normalizeVisibleDevices(config?.device, runtimeDevices);
  const splitMode = isSplitMode(config?.splitMode) ? config.splitMode : undefined;
  const mainGpu = normalizeIntegerStringWithDefault(config?.mainGpu, {
    min: mainGpuRange.min,
    max: mainGpuRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.mainGpu,
  });
  const tensorSplit = normalizeTensorSplit(config?.tensorSplit, {
    splitMode,
    runtimeDevices,
  });
  const reasoningBudget = normalizeSignedIntegerString(config?.reasoningBudget);

  if (host === '0.0.0.0' && !listenHost) {
    next.host = DEFAULT_LLAMACPP_SERVICE_CONFIG.host ?? '127.0.0.1';
    next.listenHost = host;
  } else if (host) {
    next.host = host;
  }
  if (listenHost) next.listenHost = listenHost;
  if (port) next.port = port;
  if (modelsDir) next.modelsDir = modelsDir;
  if (runtimeVersion && /^b\d+(?:-[a-f0-9]+)?$/i.test(runtimeVersion)) next.runtimeVersion = runtimeVersion;
  if (isRuntimeBackend(runtimeBackend)) next.runtimeBackend = runtimeBackend;
  if (isRuntimeCudaMajor(runtimeCudaMajor)) next.runtimeCudaMajor = runtimeCudaMajor;
  if (modelsMax) next.modelsMax = modelsMax;
  if (modelsAutoload !== undefined && modelsMax === '1') {
    if (typeof modelsAutoload === 'boolean') next.modelsAutoload = modelsAutoload;
    if (modelsAutoload === 'true') next.modelsAutoload = true;
    if (modelsAutoload === 'false') next.modelsAutoload = false;
  } else if (modelsAutoload !== undefined) {
    next.modelsAutoload = false;
  }
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

function sanitizeLlamaCppBackendRef(input: unknown): { version: string; backend: string; versionBackend: string } | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as { version?: unknown; backend?: unknown; versionBackend?: unknown };
  let version = typeof candidate.version === 'string' ? candidate.version.trim() : '';
  let backend = typeof candidate.backend === 'string' ? candidate.backend.trim() : '';
  const versionBackend = typeof candidate.versionBackend === 'string' ? candidate.versionBackend.trim() : '';
  if ((!version || !backend) && versionBackend.includes('/')) {
    const [parsedVersion, parsedBackend] = versionBackend.split('/');
    version = parsedVersion?.trim() ?? '';
    backend = parsedBackend?.trim() ?? '';
  }
  if (!isSafeLlamaCppBackendSegment(version) || !isSafeLlamaCppBackendSegment(backend)) {
    return null;
  }
  return { version, backend, versionBackend: `${version}/${backend}` };
}

function isSafeLlamaCppBackendSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && !value.includes('..');
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
  if (!trimmed) return undefined;
  const normalized = normalizeIntegerString(value);
  if (!normalized) return range.defaultValue;
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
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const normalized = normalizeSignedIntegerString(value);
  if (!normalized) return range.defaultValue;
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
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const normalized = normalizeGpuLayersString(value);
  if (!normalized) return range.defaultValue;
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

  const acceleratorDevices = getLlamaCppAcceleratorDevices(runtimeDevices).map(device => ({
    id: device.id,
    name: device.name ?? device.id,
    backend: device.backend ?? 'unknown',
  }));

  if (acceleratorDevices.length > 0) {
    const resolved = resolveLlamaCppDeviceSelection(trimmed, acceleratorDevices);
    return resolved || undefined;
  }

  if (runtimeDevices && !runtimeDevices.success) {
    return undefined;
  }

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
  return undefined;
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
