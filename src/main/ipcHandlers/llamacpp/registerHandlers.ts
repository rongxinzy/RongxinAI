// ipcMain handler registration for llama.cpp (#1069).
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';

import type { NvidiaSmiSnapshot } from '../../../shared/hardware';
import type {
  LlamaCppImportModelFilesResult,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchResult,
  LlamaCppModelPreference,
  LlamaCppModelPreferences,
  LlamaCppModelUnloadResult,
  LlamaCppRuntimeInstallSnapshot,
  LlamaCppServiceConfig,
  LlamaCppSetModelPreferenceInput,
  LlamaCppStatusSnapshot,
} from '../../../shared/llamacpp';
import {
  LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID,
  LlamaCppIpcChannel,
  LlamaCppModelLaunchLogPhase,
  LlamaCppOrchestrator,
} from '../../../shared/llamacpp';
import {
  ModelCapabilityStatus,
  parseLlamaCppRuntimeCapabilities,
  type ModelCapabilities,
} from '../../../shared/providers';
import { LlamaCppModelResidencyMode } from '../../../shared/llamacpp';
import { t } from '../../i18n';
import { LlamaCppManager } from '../../libs/llamacppManager';
import { createLlamaCppModelLaunchLogger } from '../../libs/llamacppModelLaunchLog';
import {
  getLlamaCppModelLoadFailureI18nKey,
  LlamaCppModelLoadFailureReason,
} from '../../libs/llamacppModelLoadErrors';
import { LlamaCppModelLoadLock } from '../../libs/llamacppModelLoadLock';
import { LlamaCppModelDaemonController } from '../../libs/llamacppModelDaemonController';
import type { LlamaCppModelOrchestrator } from '../../libs/llamacppModelOrchestrator';
import { LlamaCppRouterOrchestrator } from '../../libs/llamacppRouterOrchestrator';
import { evictIdleLlamaCppRouterModelsForLoad } from '../../libs/llamacppRouterEviction';
import { loadLlamaCppModelThroughPipeline } from '../../libs/llamacppModelLoadPipeline';
import {
  LlamaCppModelResidencyManager,
  LlamaCppModelResidencyState,
} from '../../libs/llamacppModelResidencyManager';
import { createLlamaCppRuntimeInstallState } from '../../libs/llamacppRuntimeInstallState';
import { buildLlamaCppRunningModelBinding } from '../../libs/llamacppAgentBinding';
import { applyLlamaCppServiceTransition } from '../../libs/llamacppServiceTransition';
import { LlamaCppServiceTransitionLock } from '../../libs/llamacppServiceTransitionLock';
import { getNvidiaSmiSnapshot } from '../../libs/nvidiaSmi';
import { getSystemMemorySnapshot } from '../../libs/systemMemory';
import type { SqliteStore } from '../../sqliteStore';
import { registerLlamaCppModelLaunchLogIpcHandlers } from '../llamacppModelLaunchLogs';
import {
  broadcastLlamaCppModelResidencyState,
  getLlamaCppLoadedModelLimitViolation,
  getRequiredVramRecoveryMiB,
  getTotalFreeVramMiB,
  hasRecoveredVram,
  throwIfLlamaCppModelLoadCancelled,
  toUserFacingLlamaCppModelLoadError,
  waitForLlamaCppModelUnloadConfirmation,
  waitForLlamaCppStartupModelBindings,
  type LlamaCppModelBindingRefreshResult,
} from './helpers';
import {
  applyStoredModelPreferencesToLaunchInput,
  enforceLlamaCppParallelTwo,
  getLlamaCppModelPreferenceInputName,
  getLlamaCppModelPreferences,
  getLlamaCppServiceConfig,
  migrateLegacyLlamaCppConfig,
  sanitizeLlamaCppBackendRef,
  sanitizeLlamaCppServiceConfig,
  sanitizeUpdatedModelPreferences,
  shouldRefreshLlamaCppModelBindings,
  isAbortError,
} from './config';

const LLAMACPP_SERVICE_CONFIG_KEY = 'llamacpp_service_config';
const LLAMACPP_MODEL_PREFERENCES_KEY = 'llamacpp_model_preferences';
const LLAMACPP_UNLOAD_VRAM_POLL_TIMEOUT_MS = 5_000;
const LLAMACPP_UNLOAD_VRAM_POLL_INTERVAL_MS = 250;
const LLAMACPP_UNLOAD_CONFIRM_TIMEOUT_MS = 8_000;
const LLAMACPP_UNLOAD_CONFIRM_POLL_INTERVAL_MS = 400;
const LLAMACPP_UNLOAD_CONFIRM_STABLE_MISSING_POLLS = 2;
const LLAMACPP_STARTUP_BINDING_SYNC_ATTEMPTS = 30;
const LLAMACPP_STARTUP_BINDING_SYNC_INTERVAL_MS = 1_000;
const LLAMACPP_MODEL_PREFERENCE_CAPABILITY_KEYS = [
  'toolCalling',
  'imageInput',
  'videoInput',
  'audioInput',
  'documentInput',
  'reasoning',
] as const;

const LlamaCppServiceStatus = {
  Running: 'running',
  Stopped: 'stopped',
} as const;

export function registerLlamaCppIpcHandlers(
  manager: LlamaCppManager,
  options: {
    getStore: () => SqliteStore;
    onModelBindingsChanged?: (
      baseUrl: string | null,
      models: readonly import('../../libs/llamacppAgentBinding').LlamaCppRunningModelBinding[],
    ) => void | Promise<void>;
  },
): LlamaCppModelOrchestrator {
  const broadcast = (channel: string, payload: unknown): void => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (win.isDestroyed()) return;
      win.webContents.send(channel, payload);
    });
  };
  const updateRunningModelBindings = async (
    runningModels: Awaited<ReturnType<LlamaCppManager['listRunningModels']>>,
  ): Promise<boolean> => {
    const store = options.getStore();
    const modelPreferences = getLlamaCppModelPreferences(store);
    const client = runningModels.length > 0 ? await manager.client() : null;
    const bindingModels = (
      await Promise.all(
        runningModels.map(async runningModel => {
          const model = buildLlamaCppRunningModelBinding(runningModel);
          if (!model) return null;
          let detectedCapabilities: Partial<ModelCapabilities> = {};
          try {
            if (client) {
              detectedCapabilities = parseLlamaCppRuntimeCapabilities(
                await client.showModel(model.id),
              );
            }
          } catch {
            // Runtime metadata is optional; context and loaded state remain usable.
          }
          const preference = modelPreferences[model.id];
          const preferenceCapabilities = preference?.capabilities;
          const capabilities = {
            ...detectedCapabilities,
            ...(runningModel.supportsThinkingToggle === true
              ? { reasoning: ModelCapabilityStatus.Supported }
              : {}),
            ...(preferenceCapabilities ?? {}),
          };
          return {
            ...model,
            ...(preference?.ctxSize ? { contextWindow: preference.ctxSize } : {}),
            ...(preference?.maxTokens ? { maxTokens: preference.maxTokens } : {}),
            ...(Object.keys(capabilities).length ? { capabilities } : {}),
          };
        }),
      )
    ).filter((model): model is NonNullable<typeof model> => Boolean(model));
    await options.onModelBindingsChanged?.(daemon.gatewayBaseUrl(), bindingModels);
    broadcast(LlamaCppIpcChannel.ModelBindingsChanged, undefined);
    return true;
  };

  const refreshRunningModelBindings = async (
    input: { preserveExistingWhenEmpty?: boolean } = {},
  ): Promise<LlamaCppModelBindingRefreshResult> => {
    if (bindingRefreshSuppressed) {
      return { changed: false, hasRunningModels: false };
    }
    const refreshGeneration = bindingRefreshGeneration;
    try {
      const runningModels = await daemon.listRunningModels();
      if (bindingRefreshSuppressed || refreshGeneration !== bindingRefreshGeneration) {
        return { changed: false, hasRunningModels: false };
      }
      if (input.preserveExistingWhenEmpty && runningModels.length === 0) {
        // Router health can precede automatic model loading; do not erase bindings during that gap.
        return { changed: false, hasRunningModels: false };
      }
      for (const model of runningModels) {
        const modelName = (model.name || model.model || model.id || '').trim();
        const snapshot = modelName ? residency.getSnapshot(modelName) : undefined;
        if (modelName && (!snapshot || snapshot.state === LlamaCppModelResidencyState.Unloaded)) {
          residency.markReady(modelName);
        }
      }
      return {
        changed: await updateRunningModelBindings(runningModels),
        hasRunningModels: runningModels.length > 0,
      };
    } catch (error) {
      if (bindingRefreshSuppressed || refreshGeneration !== bindingRefreshGeneration) {
        return { changed: false, hasRunningModels: false };
      }
      // Fail closed in the unified catalog while the local runtime cannot be reached.
      await options.onModelBindingsChanged?.(null, []);
      console.warn(
        '[LlamaCpp] skipped model binding refresh because running models could not be read:',
        error,
      );
      return { changed: false, hasRunningModels: false };
    }
  };

  const sendProgress = (progress: LlamaCppInstallProgress) =>
    broadcast(LlamaCppIpcChannel.InstallProgress, progress);
  const { sendModelLaunchLog } = registerLlamaCppModelLaunchLogIpcHandlers({
    broadcast,
  });
  const resolveServiceConfig = () => {
    const config = getLlamaCppServiceConfig(options.getStore());
    return {
      ...config,
      modelsDir: config.modelsDir?.trim() || manager.getModelsDir(),
    };
  };
  const createDaemonOrchestrator = (): LlamaCppModelOrchestrator =>
    new LlamaCppModelDaemonController({
      userDataPath: app.getPath('userData'),
      getStore: options.getStore,
      getServiceConfig: resolveServiceConfig,
    });
  const createRouterOrchestrator = (): LlamaCppRouterOrchestrator =>
    new LlamaCppRouterOrchestrator({
      userDataPath: app.getPath('userData'),
      getStore: options.getStore,
      getServiceConfig: resolveServiceConfig,
      getModelsDir: () => manager.getModelsDir(),
      getPresetPath: () => manager.getPresetPath(),
      acquireModelLease: (modelName, load) => residency.acquire(modelName, load),
    });
  // The implementation is chosen once, at registration, from the config's
  // `orchestrator` field (default router); a switch takes effect on the next
  // app start. `daemon` keeps its name so the ~20 call sites stay unchanged.
  const useRouterOrchestrator =
    resolveServiceConfig().orchestrator !== LlamaCppOrchestrator.Daemon;
  const routerOrchestrator = useRouterOrchestrator ? createRouterOrchestrator() : null;
  const daemon: LlamaCppModelOrchestrator = routerOrchestrator ?? createDaemonOrchestrator();
  const stopLeftoverDaemonBeforeStart = async (): Promise<void> => {
    if (!routerOrchestrator) return;
    // Upgrades from the daemon build may leave a detached daemon (spawned with
    // keepRunningOnAppQuit) holding config.port. Stop it through the existing
    // controller before the router gateway binds; nothing to do when none is
    // registered.
    const leftover = new LlamaCppModelDaemonController({
      userDataPath: app.getPath('userData'),
      getStore: options.getStore,
      getServiceConfig: resolveServiceConfig,
    });
    const reconnected = await leftover.reconnect().catch((): null => null);
    if (reconnected) {
      await leftover.stopService().catch((error: unknown) => {
        console.warn('[LlamaCpp] failed to stop the leftover model daemon:', error);
      });
    }
  };
  const loadModelLock = new LlamaCppModelLoadLock();
  let activeModelLoad: { modelName: string; controller: AbortController } | null = null;
  let loadModelCore: (input: LlamaCppModelLaunchInput) => Promise<LlamaCppModelLaunchResult>;
  const residency = new LlamaCppModelResidencyManager({
    getPolicy: modelName => {
      const serviceStatus =
        typeof manager.getStatus === 'function' ? manager.getStatus() : undefined;
      if (serviceStatus?.managedByApp === false) {
        return { mode: LlamaCppModelResidencyMode.Forever };
      }
      return getLlamaCppModelPreferences(options.getStore())[modelName]?.residency;
    },
    unload: async modelName => {
      await daemon.stopModel(modelName);
      const confirmation = await waitForLlamaCppModelUnloadConfirmation({
        modelName,
        listRunningModels: () => daemon.listRunningModels(),
      });
      await updateRunningModelBindings(confirmation.runningModels);
    },
    onStateChanged: snapshot => broadcastLlamaCppModelResidencyState(broadcast, snapshot),
  });
  const serviceTransitionLock = new LlamaCppServiceTransitionLock();
  const runServiceTransition = async <T>(action: () => Promise<T>): Promise<T> =>
    await serviceTransitionLock.runExclusive(
      action,
      () => new Error(t('llamacppLoadModelServiceUnavailable')),
    );
  let bindingRefreshSuppressed = false;
  let bindingRefreshGeneration = 0;
  let startupBindingSyncGeneration = 0;

  const scheduleStartupModelBindingSync = (): void => {
    const syncGeneration = ++startupBindingSyncGeneration;
    void waitForLlamaCppStartupModelBindings({
      refresh: async () =>
        (await refreshRunningModelBindings({ preserveExistingWhenEmpty: true })).hasRunningModels,
      isCurrent: () => syncGeneration === startupBindingSyncGeneration,
    });
  };
  const getDedicatedServiceStatus = async (): Promise<LlamaCppStatusSnapshot> => {
    return await daemon.status();
  };

  migrateLegacyLlamaCppConfig(options.getStore());
  const runtimeInstallState = createLlamaCppRuntimeInstallState();
  manager.on('install-progress', progress => {
    if (progress.modelId === LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID) {
      runtimeInstallState.update(progress);
    }
    sendProgress(progress);
  });

  const activeInstalls = new Map<string, AbortController>();
  type RuntimeInstallResult = Awaited<ReturnType<LlamaCppManager['installRuntime']>>;
  let runtimeInstallController: AbortController | null = null;
  let activeRuntimeInstall: Promise<RuntimeInstallResult> | null = null;
  const runRuntimeInstall = (
    install: (signal: AbortSignal) => Promise<RuntimeInstallResult>,
  ): Promise<RuntimeInstallResult> => {
    if (activeRuntimeInstall) return activeRuntimeInstall;
    const controller = new AbortController();
    runtimeInstallState.start();
    runtimeInstallController = controller;
    const installPromise = install(controller.signal).finally(() => {
      runtimeInstallState.finish();
      if (activeRuntimeInstall === installPromise) activeRuntimeInstall = null;
      if (runtimeInstallController === controller) runtimeInstallController = null;
    });
    activeRuntimeInstall = installPromise;
    return installPromise;
  };

  ipcMain.handle(LlamaCppIpcChannel.Status, async () => await getDedicatedServiceStatus());
  ipcMain.handle(LlamaCppIpcChannel.Install, async () =>
    runRuntimeInstall(signal => manager.installRuntime({ signal })),
  );
  ipcMain.handle(
    LlamaCppIpcChannel.GetRuntimeInstallSnapshot,
    (): LlamaCppRuntimeInstallSnapshot => runtimeInstallState.snapshot(),
  );
  ipcMain.handle(LlamaCppIpcChannel.CancelRuntimeInstall, async () => {
    const controller = runtimeInstallController;
    const install = activeRuntimeInstall;
    if (!controller || controller.signal.aborted || !install) {
      return { success: true as const, cancelled: false };
    }

    controller.abort();
    const result = await install.catch((): RuntimeInstallResult | undefined => undefined);
    return { success: true as const, cancelled: Boolean(result?.cancelled) };
  });
  ipcMain.handle(LlamaCppIpcChannel.UninstallRuntime, async () => {
    await daemon.stopService();
    await updateRunningModelBindings([]);
    return await manager.uninstallRuntime();
  });
  ipcMain.handle(LlamaCppIpcChannel.ListRuntimeDevices, async (_event, input: unknown) => {
    const ref = sanitizeLlamaCppBackendRef(input);
    return await manager.listRuntimeDevices(ref ?? undefined);
  });
  ipcMain.handle(LlamaCppIpcChannel.ListBackends, async () => manager.listBackends());
  ipcMain.handle(LlamaCppIpcChannel.GetBackendDownloadSize, async (_event, input: unknown) => {
    const ref = sanitizeLlamaCppBackendRef(input);
    if (!ref) return { success: false, error: 'Invalid llama.cpp backend selection.' };
    return await manager.getBackendDownloadSize(ref);
  });
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
    return await runRuntimeInstall(signal => manager.setBackendSelection(ref, { signal }));
  });
  ipcMain.handle(LlamaCppIpcChannel.InstallBackend, async (_event, input: unknown) => {
    const ref = sanitizeLlamaCppBackendRef(input);
    if (!ref) return await runRuntimeInstall(signal => manager.installRuntime({ signal }));
    return await runRuntimeInstall(signal => manager.setBackendSelection(ref, { signal }));
  });
  ipcMain.handle(LlamaCppIpcChannel.UninstallBackend, async (_event, input: unknown) => {
    await daemon.stopService();
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
  ipcMain.handle(LlamaCppIpcChannel.Start, async () => {
    const status = await getDedicatedServiceStatus();
    if (status.status === LlamaCppServiceStatus.Running) {
      const bindingRefresh = await refreshRunningModelBindings({
        preserveExistingWhenEmpty: true,
      });
      if (!bindingRefresh.hasRunningModels) {
        scheduleStartupModelBindingSync();
      }
    }
    return status;
  });
  ipcMain.handle(LlamaCppIpcChannel.Stop, async () => {
    // Cancel delayed startup polling before the explicit stop clears the model bindings.
    startupBindingSyncGeneration += 1;
    await daemon.stopService();
    const status: LlamaCppStatusSnapshot = {
      status: LlamaCppServiceStatus.Stopped,
      managedByApp: true,
      checkedAt: new Date().toISOString(),
    };
    if (status.status === LlamaCppServiceStatus.Stopped) {
      await updateRunningModelBindings([]);
    }
    return status;
  });
  ipcMain.handle(
    LlamaCppIpcChannel.Restart,
    async () =>
      await runServiceTransition(async () => {
        const config = getLlamaCppServiceConfig(options.getStore());
        const status = await daemon.restart(config);
        await refreshRunningModelBindings();
        return status;
      }),
  );
  ipcMain.handle(LlamaCppIpcChannel.GetServiceConfig, async () =>
    getLlamaCppServiceConfig(options.getStore()),
  );
  ipcMain.handle(
    LlamaCppIpcChannel.SetServiceConfig,
    async (_event, config: LlamaCppServiceConfig) => {
      const sanitized = sanitizeLlamaCppServiceConfig(config);
      options.getStore().set(LLAMACPP_SERVICE_CONFIG_KEY, sanitized);
      await daemon.applyConfigIfRunning(sanitized);
      return sanitized;
    },
  );
  ipcMain.handle(LlamaCppIpcChannel.GetGatewayLanToken, async () => ({
    token: daemon.getLanToken(),
  }));
  ipcMain.handle(LlamaCppIpcChannel.RegenerateGatewayLanToken, async () => ({
    token: await daemon.regenerateLanToken(),
  }));
  ipcMain.handle(LlamaCppIpcChannel.ModelsDir, async () => manager.getModelsDir());
  ipcMain.handle(
    LlamaCppIpcChannel.SetModelsDir,
    async (_event, modelsDir: unknown) =>
      await runServiceTransition(async () => {
        const store = options.getStore();
        const currentConfig = store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY) ?? {};
        const trimmedModelsDir = typeof modelsDir === 'string' ? modelsDir.trim() : '';
        const nextConfig = sanitizeLlamaCppServiceConfig({
          ...currentConfig,
          modelsDir: trimmedModelsDir || undefined,
        });
        const modelsDirChanged =
          (currentConfig.modelsDir?.trim() || '') !== (nextConfig.modelsDir?.trim() || '');
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
          refreshBindings: async () => {
            await refreshRunningModelBindings();
          },
          setBindingRefreshSuppressed: suppressed => {
            bindingRefreshSuppressed = suppressed;
            if (suppressed) bindingRefreshGeneration += 1;
          },
        });
        if (wasRunning && nextStatus?.status !== 'running') {
          throw new Error(t('llamacppServiceStartupUnknown'));
        }
        return manager.getModelsDir();
      }),
  );

  ipcMain.handle(LlamaCppIpcChannel.ListLocalModels, async () => {
    return await manager.listLocalModels();
  });
  ipcMain.handle(LlamaCppIpcChannel.ListRunningModels, async () => {
    try {
      // Keep model listing read-only. Binding persistence and Gateway sync are
      // performed by explicit model lifecycle transitions below.
      return await daemon.listRunningModels();
    } catch (error) {
      if (manager.getStatus().status !== 'running') return [];
      throw error;
    }
  });
  ipcMain.handle(LlamaCppIpcChannel.RefreshRunningModelBindings, async () => {
    await refreshRunningModelBindings();
  });
  ipcMain.handle(LlamaCppIpcChannel.DeleteModel, async (_event, name: string) => {
    await daemon.stopModel(name);
    const result = await manager.deleteModel(name);
    if (!result.success || !result.deleted || !result.removedModelName) {
      return result;
    }

    const store = options.getStore();
    const modelPreferences = getLlamaCppModelPreferences(store);
    if (modelPreferences[result.removedModelName]) {
      const { [result.removedModelName]: _removedPreference, ...nextPreferences } =
        modelPreferences;
      store.set(LLAMACPP_MODEL_PREFERENCES_KEY, nextPreferences);
    }
    await refreshRunningModelBindings();
    return result;
  });
  ipcMain.handle(LlamaCppIpcChannel.ShowModel, async (_event, name: string) => {
    const modelName = name.trim();
    const localModel = (await manager.listLocalModels()).find(
      model => model.name === modelName || model.id === modelName || model.model === modelName,
    );
    if (!localModel) throw new Error('Local model was not found.');
    const runningModel = (await daemon.listRunningModels()).find(
      model => model.name === modelName || model.id === modelName || model.model === modelName,
    );
    return {
      ...localModel,
      ...(runningModel ?? {}),
      status: runningModel ? 'loaded' : 'unloaded',
    };
  });
  ipcMain.handle(LlamaCppIpcChannel.GetModelPreferences, async () => {
    return getLlamaCppModelPreferences(options.getStore());
  });
  ipcMain.handle(LlamaCppIpcChannel.SetModelPreference, async (_event, input: unknown) => {
    const store = options.getStore();
    const current = getLlamaCppModelPreferences(store);
    const next = sanitizeUpdatedModelPreferences(current, input);
    store.set(LLAMACPP_MODEL_PREFERENCES_KEY, next);
    const modelName = getLlamaCppModelPreferenceInputName(input);
    if (modelName && shouldRefreshLlamaCppModelBindings(current[modelName], next[modelName])) {
      await refreshRunningModelBindings();
    }
    return next;
  });
  ipcMain.handle(LlamaCppIpcChannel.ImportModelFiles, async (_event, input: unknown) => {
    const paths = Array.isArray(input)
      ? input.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        )
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
  loadModelCore = async (input: LlamaCppModelLaunchInput) => {
    const modelName = input.model.trim();
    const launchLogger = createLlamaCppModelLaunchLogger({
      modelName,
      emit: sendModelLaunchLog,
    });
    launchLogger.info(LlamaCppModelLaunchLogPhase.Requested, undefined, { modelName });
    if (!modelName) {
      launchLogger.error(LlamaCppModelLaunchLogPhase.Failed, undefined, 'Model name is required');
      throw new Error(
        t(getLlamaCppModelLoadFailureI18nKey(LlamaCppModelLoadFailureReason.ModelNotFound)),
      );
    }
    if (serviceTransitionLock.isActive()) {
      launchLogger.error(
        LlamaCppModelLaunchLogPhase.Failed,
        undefined,
        'Service transition is active',
      );
      throw new Error(t('llamacppLoadModelServiceUnavailable'));
    }
    return await loadModelLock.runExclusive(
      modelName,
      async () => {
        const controller = new AbortController();
        activeModelLoad = { modelName, controller };
        const store = options.getStore();
        const serviceConfig = getLlamaCppServiceConfig(store);
        const inputWithPreferences = applyStoredModelPreferencesToLaunchInput(store, input);
        try {
          launchLogger.info(LlamaCppModelLaunchLogPhase.CheckingService);
          throwIfLlamaCppModelLoadCancelled(controller.signal);
          let runningModels = await daemon.listRunningModels();
          throwIfLlamaCppModelLoadCancelled(controller.signal);
          let loadLimitViolation = getLlamaCppLoadedModelLimitViolation({
            modelsMax: serviceConfig.modelsMax,
            runningModels,
            targetModelName: modelName,
          });
          if (loadLimitViolation && routerOrchestrator) {
            // Router mode owns capacity: free room by evicting idle models
            // (never one whose /slots is busy or unknown) instead of failing
            // immediately like the daemon path does.
            const freedModels = await evictIdleLlamaCppRouterModelsForLoad({
              limit: loadLimitViolation.limit,
              runningModelNames: runningModels.map(
                model => (model.name || model.model || model.id || '').trim(),
              ),
              targetModelName: modelName,
              slotsBusy: async candidateName =>
                await routerOrchestrator.getModelSlots(candidateName).then(slots => slots.busy),
              stopModel: async candidateName => {
                await daemon.stopModel(candidateName);
              },
            });
            if (freedModels.length > 0) {
              launchLogger.info(LlamaCppModelLaunchLogPhase.LoadingModel, undefined, {
                evictedIdleModels: freedModels,
              });
              runningModels = await daemon.listRunningModels();
              loadLimitViolation = getLlamaCppLoadedModelLimitViolation({
                modelsMax: serviceConfig.modelsMax,
                runningModels,
                targetModelName: modelName,
              });
            }
          }
          if (loadLimitViolation) {
            launchLogger.error(LlamaCppModelLaunchLogPhase.Failed, undefined, loadLimitViolation);
            throw new Error(
              t('llamacppLoadModelLimitReached')
                .replace('{limit}', String(loadLimitViolation.limit))
                .replace('{next}', String(loadLimitViolation.next)),
            );
          }

          const localModels = await manager.listLocalModels();
          throwIfLlamaCppModelLoadCancelled(controller.signal);
          const targetModel = localModels.find(
            model =>
              model.name === modelName || model.id === modelName || model.model === modelName,
          );
          launchLogger.info(LlamaCppModelLaunchLogPhase.PreparingModel, undefined, {
            modelFound: Boolean(targetModel),
            modelSizeBytes: targetModel?.size,
            modelPath: targetModel?.path,
          });
          launchLogger.info(LlamaCppModelLaunchLogPhase.CheckingRuntime);
          try {
            if (!targetModel?.path) {
              throw new Error(
                t(getLlamaCppModelLoadFailureI18nKey(LlamaCppModelLoadFailureReason.ModelNotFound)),
              );
            }
            launchLogger.info(LlamaCppModelLaunchLogPhase.LoadingModel);
            const runtimeCapabilities = await manager
              .getRuntimeCapabilities()
              .catch((): null => null);
            const nvidiaSnapshot = await getNvidiaSmiSnapshot().catch((): null => null);
            const pipelineResult = await loadLlamaCppModelThroughPipeline({
              launchInput: {
                ...inputWithPreferences,
                model: modelName,
                modelPath: targetModel.path,
              },
              runtimeBackend: serviceConfig.runtimeBackend,
              runtimeCapabilities,
              nvidiaSnapshot,
              systemMemorySnapshot: getSystemMemorySnapshot(),
              memoryPolicy: serviceConfig.memoryPolicy,
              memoryBudgetPercent: serviceConfig.memoryBudgetPercent,
              modelSizeBytes: targetModel.size,
              cacheTypeK: serviceConfig.cacheTypeK,
              cacheTypeV: serviceConfig.cacheTypeV,
              signal: controller.signal,
              onLog: launchLogger.report,
              loadModel: async launchInput => {
                const daemonStatus = await daemon.ensureModel({
                  ...launchInput,
                  model: modelName,
                  modelPath: targetModel.path,
                });
                return { success: true, runningModels: daemonStatus.runningModels };
              },
              listModels: async () => {
                const runningModels = await daemon.listRunningModels();
                const runningNames = new Set(
                  runningModels.map(model => model.name || model.model || model.id).filter(Boolean),
                );
                return (await manager.listLocalModels()).map(model =>
                  runningNames.has(model.name) ? { ...model, status: 'loaded' } : model,
                );
              },
              listRunningModels: () => daemon.listRunningModels(),
              detectService: () => daemon.status(),
              unloadModel: async unloadModelName => {
                await daemon.stopModel(unloadModelName);
              },
            });
            throwIfLlamaCppModelLoadCancelled(controller.signal);
            const result: LlamaCppModelLaunchResult = {
              success: true,
              runningModels: pipelineResult.runningModels,
            };
            await updateRunningModelBindings(result.runningModels);
            launchLogger.info(LlamaCppModelLaunchLogPhase.Succeeded, undefined, {
              runningModelCount: result.runningModels.length,
            });
            return result;
          } catch (error) {
            if (controller.signal.aborted) {
              await daemon.stopModel(modelName);
              await refreshRunningModelBindings();
              launchLogger.info(LlamaCppModelLaunchLogPhase.Failed, 'Model startup cancelled');
              throw new Error(t('llamacppModelLoadCancelled'));
            }
            launchLogger.error(LlamaCppModelLaunchLogPhase.Failed, undefined, error);
            throw toUserFacingLlamaCppModelLoadError(error);
          }
        } finally {
          if (activeModelLoad?.controller === controller) {
            activeModelLoad = null;
          }
        }
      },
      () => {
        launchLogger.error(
          LlamaCppModelLaunchLogPhase.Failed,
          undefined,
          'Another model load is in progress',
        );
        return new Error(t('llamacppModelLoadInProgress'));
      },
    );
  };
  void (async () => {
    // In router mode this also clears a leftover daemon from the previous
    // build before the router gateway binds config.port for the first time.
    await stopLeftoverDaemonBeforeStart();
    await daemon
      .reconnect()
      .then(() => refreshRunningModelBindings())
      .catch(error => {
        console.error('[LlamaCppDaemon] failed to reconnect to local inference daemon:', error);
      });
  })();
  ipcMain.handle(LlamaCppIpcChannel.LoadModel, async (_event, input: LlamaCppModelLaunchInput) => {
    let result: LlamaCppModelLaunchResult | undefined;
    await residency.ensureReady(input.model, async () => {
      result = await loadModelCore(input);
    });
    return result ?? { success: true, runningModels: await daemon.listRunningModels() };
  });
  ipcMain.handle(LlamaCppIpcChannel.CancelModelLoad, async (_event, input: unknown) => {
    const activeLoad = activeModelLoad;
    const requestedModelName = typeof input === 'string' ? input.trim() : '';
    if (
      !activeLoad ||
      activeLoad.controller.signal.aborted ||
      (requestedModelName && requestedModelName !== activeLoad.modelName)
    ) {
      return { success: true, cancelled: false };
    }

    activeLoad.controller.abort();
    return {
      success: true,
      cancelled: true,
      modelName: activeLoad.modelName,
    };
  });
  ipcMain.handle(LlamaCppIpcChannel.UnloadModel, async (_event, name: string) => {
    const modelName = name.trim();
    if (!modelName) throw new Error('Model name is required');
    const beforeRunningModels = await daemon.listRunningModels();
    const unloadingModel = beforeRunningModels.find(
      model => model.name === modelName || model.model === modelName || model.id === modelName,
    );
    const beforeSnapshot = unloadingModel?.size_vram ? await getNvidiaSmiSnapshot() : null;
    await daemon.stopModel(modelName);
    const confirmation = await waitForLlamaCppModelUnloadConfirmation({
      modelName,
      listRunningModels: () => daemon.listRunningModels(),
    });
    residency.markUnloaded(modelName);
    await updateRunningModelBindings(confirmation.runningModels);
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
  return daemon;
}

export {
  enforceLlamaCppParallelTwo,
  getLlamaCppModelPreferences,
  getLlamaCppServiceConfig,
  sanitizeLlamaCppModelPreference,
  sanitizeLlamaCppServiceConfig,
  shouldRefreshLlamaCppModelBindings,
} from './config';
