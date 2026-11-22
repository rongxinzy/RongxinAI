// ipcMain handler registration for llama.cpp (#1069).
import { app, BrowserWindow, dialog } from 'electron';
import fs from 'fs';

import type {
  LlamaCppBackendRef,
  LlamaCppImportModelFilesResult,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchResult,
  LlamaCppModelUnloadResult,
  LlamaCppRuntimeInstallSnapshot,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../../shared/llamacpp';
import {
  LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID,
  LlamaCppBackendError,
  LlamaCppIpcChannel,
  LlamaCppModelLaunchLogPhase,
  LlamaCppOrchestrator,
} from '../../../shared/llamacpp';
import { t } from '../../i18n';
import { LlamaCppManager } from '../../libs/llamacppManager';
import { readCurrentBackendRef, syncCurrentBackend } from '../../libs/llamacppBackendManager';
import { removeCurrentBackendLink } from '../../libs/llamacppBackendManager/paths';
import { switchLlamaCppBackend } from '../../libs/llamacppBackendVersionSwitch';
import { getUserLlamaCppRuntimeRoot } from '../../libs/llamacppRuntimePaths';
import { llamacppContract } from '../../../shared/ipc/llamacppContract';
import { handleIpcContract, handleIpcContractSubset } from '../../ipc/handleIpcContract';
import { createLlamaCppModelLaunchLogger } from '../../libs/llamacppModelLaunchLog';
import { isLlamaCppLanAccessEnabled } from '../../magpie/lanAccess';
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
import {
  buildLlamaCppRunningModelBindings,
  type LocalGpuSnapshot,
} from '../../libs/llamacppAgentBinding';
import { LlamaCppServiceTransitionLock } from '../../libs/llamacppServiceTransitionLock';
import { getNvidiaSmiSnapshot } from '../../libs/nvidiaSmi';
import { getSystemMemorySnapshot } from '../../libs/systemMemory';
import type { SqliteStore } from '../../sqliteStore';
import { registerLlamaCppModelLaunchLogIpcHandlers } from '../llamacppModelLaunchLogs';
import {
  broadcastLlamaCppModelResidencyState,
  getLlamaCppLoadedModelLimitViolation,
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
    /** Notified when the LAN access toggle or its token changes so the model gateway follows. */
    onLanAccessChanged?: () => void | Promise<void>;
    /** Notified after a LAN token regeneration so the imported gateway key is replaced. */
    onLanAccessTokenRegenerated?: () => void | Promise<void>;
  },
) {
  let closing = false;
  const pending = new Set<Promise<unknown>>();
  const runWhileOpen = async <T>(run: () => T): Promise<Awaited<T>> => {
    if (closing) throw new Error(t('llamacppLoadModelServiceUnavailable'));
    const operation = Promise.resolve(run());
    pending.add(operation);
    try {
      return await operation;
    } finally {
      pending.delete(operation);
    }
  };
  const broadcast = (channel: string, payload: unknown): void => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (win.isDestroyed()) return;
      win.webContents.send(channel, payload);
    });
  };
  const projectBindings = (
    runningModels: Awaited<ReturnType<LlamaCppModelOrchestrator['listRunningModels']>>,
  ) =>
    buildLlamaCppRunningModelBindings(
      runningModels,
      getLlamaCppModelPreferences(options.getStore()),
    );
  const updateRunningModelBindings = async (
    runningModels: Parameters<typeof projectBindings>[0],
    baseUrl = daemon.gatewayBaseUrl(),
  ): Promise<boolean> => {
    if (closing) return false;
    await options.onModelBindingsChanged?.(baseUrl, projectBindings(runningModels));
    broadcast(LlamaCppIpcChannel.ModelBindingsChanged, undefined);
    return true;
  };

  const readCurrentBindingState = async () => {
    const generation = bindingRefreshGeneration;
    const isCurrent = () =>
      !closing && !bindingRefreshSuppressed && generation === bindingRefreshGeneration;
    if (!isCurrent()) return;
    try {
      const snapshot = await daemon.reconnect();
      if (isCurrent()) {
        return {
          runningModels: snapshot?.runningModels ?? [],
          baseUrl: snapshot?.gatewayBaseUrl ?? null,
        };
      }
    } catch (error) {
      if (isCurrent()) throw error;
    }
  };

  const refreshRunningModelBindings = async (
    input: { preserveExistingWhenEmpty?: boolean } = {},
  ): Promise<LlamaCppModelBindingRefreshResult> => {
    if (closing || bindingRefreshSuppressed) {
      return { changed: false, hasRunningModels: false };
    }
    const refreshGeneration = bindingRefreshGeneration;
    try {
      const snapshot = await readCurrentBindingState();
      if (!snapshot || closing || refreshGeneration !== bindingRefreshGeneration) {
        return { changed: false, hasRunningModels: false };
      }
      const { runningModels, baseUrl } = snapshot;
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
        changed: await updateRunningModelBindings(runningModels, baseUrl),
        hasRunningModels: runningModels.length > 0,
      };
    } catch (error) {
      if (closing || bindingRefreshSuppressed || refreshGeneration !== bindingRefreshGeneration) {
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
      stopPreviousDaemon: async () => {
        const leftover = createDaemonOrchestrator();
        if (await leftover.reconnect({ requireResponsive: true })) await leftover.stopService();
      },
      acquireModelLease: (modelName, load) => {
        if (closing || serviceTransitionLock.isActive())
          throw new Error(t('llamacppLoadModelServiceUnavailable'));
        return runWhileOpen(() => residency.acquire(modelName, load));
      },
    });
  // The implementation is chosen once, at registration, from the config's
  // `orchestrator` field (default router); a switch takes effect on the next
  // app start. `daemon` keeps its name so the ~20 call sites stay unchanged.
  const useRouterOrchestrator = resolveServiceConfig().orchestrator !== LlamaCppOrchestrator.Daemon;
  const routerOrchestrator = useRouterOrchestrator ? createRouterOrchestrator() : null;
  const daemon: LlamaCppModelOrchestrator = routerOrchestrator ?? createDaemonOrchestrator();
  const loadModelLock = new LlamaCppModelLoadLock();
  let activeModelLoad: { modelName: string; controller: AbortController } | null = null;
  let loadModelCore: (input: LlamaCppModelLaunchInput) => Promise<LlamaCppModelLaunchResult>;
  const residency = new LlamaCppModelResidencyManager({
    getPolicy: modelName =>
      closing ? undefined : getLlamaCppModelPreferences(options.getStore())[modelName]?.residency,
    unload: modelName =>
      runWhileOpen(async () => {
        await daemon.stopModel(modelName);
        const confirmation = await waitForLlamaCppModelUnloadConfirmation({
          modelName,
          listRunningModels: readRunningModels,
        });
        await updateRunningModelBindings(confirmation.runningModels);
      }),
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

  const suspendBindingReads = async <T>(run: () => Promise<T>): Promise<T> => {
    bindingRefreshSuppressed = true;
    bindingRefreshGeneration += 1;
    startupBindingSyncGeneration += 1;
    try {
      return await run();
    } finally {
      bindingRefreshSuppressed = false;
    }
  };

  const scheduleStartupModelBindingSync = (): void => {
    if (closing) return;
    const syncGeneration = ++startupBindingSyncGeneration;
    void waitForLlamaCppStartupModelBindings({
      refresh: () =>
        runWhileOpen(
          async () =>
            (await refreshRunningModelBindings({ preserveExistingWhenEmpty: true }))
              .hasRunningModels,
        ),
      isCurrent: () => syncGeneration === startupBindingSyncGeneration,
    });
  };
  const readRunningModels = async () => (await daemon.reconnect())?.runningModels ?? [];
  const readServiceStatus = async (): Promise<LlamaCppStatusSnapshot> => {
    return (
      (await daemon.reconnect())?.status ?? {
        status: LlamaCppServiceStatus.Stopped,
        managedByApp: true,
        checkedAt: new Date().toISOString(),
      }
    );
  };

  const changeModelsDir = async (
    store: SqliteStore,
    previous: LlamaCppServiceConfig | undefined,
    next: LlamaCppServiceConfig,
  ): Promise<void> => {
    if (loadModelLock.getActiveModelName()) throw new Error(t('llamacppLoadModelInProgress'));
    if (next.modelsDir) await fs.promises.mkdir(next.modelsDir, { recursive: true });
    try {
      await suspendBindingReads(async () => {
        const runtime = await daemon.reconnect({ requireResponsive: true }).catch(error => {
          throw new Error(t('llamacppLoadModelServiceUnavailable'), { cause: error });
        });
        store.set(LLAMACPP_SERVICE_CONFIG_KEY, next);
        if (runtime?.status.status !== LlamaCppServiceStatus.Running) return;
        residency.reset();
        try {
          const status = await daemon.restart(resolveServiceConfig());
          if (status.status !== LlamaCppServiceStatus.Running) {
            throw new Error(status.error || t('llamacppServiceStartupUnknown'));
          }
        } catch (error) {
          if (previous) store.set(LLAMACPP_SERVICE_CONFIG_KEY, previous);
          else store.delete(LLAMACPP_SERVICE_CONFIG_KEY);
          throw error;
        }
      });
    } finally {
      await refreshRunningModelBindings();
    }
  };

  enforceLlamaCppParallelTwo(options.getStore());
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
    if (serviceTransitionLock.isActive()) {
      const error = LlamaCppBackendError.SwitchRequiresStoppedService;
      return Promise.resolve({
        success: false,
        error,
        plan: { kind: 'needs-manual', message: error },
      });
    }
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

  const stopRuntime = async (requireIdle = false) => {
    await suspendBindingReads(() => daemon.stopService({ requireIdle }));
    residency.reset();
    await updateRunningModelBindings([], null);
  };
  const hasModelWork = () =>
    Boolean(loadModelLock.getActiveModelName()) || residency.hasActiveWork();
  const activateBackend = (ref: LlamaCppBackendRef, signal: AbortSignal) =>
    runServiceTransition(async () => {
      signal.throwIfAborted();
      const root = getUserLlamaCppRuntimeRoot();
      const previous = readCurrentBackendRef(root);
      if (previous?.versionBackend === ref.versionBackend) return;
      try {
        await suspendBindingReads(() =>
          switchLlamaCppBackend({
            runtime: daemon,
            busy: hasModelWork,
            activate: () => {
              signal.throwIfAborted();
              syncCurrentBackend(root, ref);
              residency.reset();
            },
            restore: () =>
              previous ? syncCurrentBackend(root, previous) : removeCurrentBackendLink(root),
          }),
        );
      } finally {
        await refreshRunningModelBindings();
      }
    });
  const installRuntime = (ref?: LlamaCppBackendRef) =>
    runRuntimeInstall(signal => {
      const installOptions = {
        signal,
        activate: (backend: LlamaCppBackendRef) => activateBackend(backend, signal),
      };
      return ref
        ? manager.setBackendSelection(ref, installOptions)
        : manager.installRuntime(installOptions);
    });
  const uninstallRuntime = (ref?: LlamaCppBackendRef) =>
    runServiceTransition(async () => {
      if (activeRuntimeInstall) throw new Error(LlamaCppBackendError.SwitchRequiresStoppedService);
      await daemon.reconnect({ requireResponsive: true });
      await stopRuntime();
      return manager.uninstallRuntime(ref);
    });

  const impls: Record<string, unknown> = {};
  const registerImpl = (method: string, fn: (...args: never[]) => unknown): void => {
    impls[method] = (...args: never[]) => runWhileOpen(() => fn(...args));
  };

  registerImpl('status', readServiceStatus);
  registerImpl('install', () => installRuntime());
  registerImpl('getRuntimeInstallSnapshot', (): LlamaCppRuntimeInstallSnapshot =>
    runtimeInstallState.snapshot(),
  );
  registerImpl('cancelRuntimeInstall', async () => {
    const controller = runtimeInstallController;
    const install = activeRuntimeInstall;
    if (!controller || controller.signal.aborted || !install) {
      return { success: true as const, cancelled: false };
    }

    controller.abort();
    const result = await install.catch((): RuntimeInstallResult | undefined => undefined);
    return { success: true as const, cancelled: Boolean(result?.cancelled) };
  });
  registerImpl('uninstallRuntime', () => uninstallRuntime());
  registerImpl('listBackends', async () => manager.listBackends());
  registerImpl('installBackend', async (_event: unknown, input: unknown) => {
    const ref = sanitizeLlamaCppBackendRef(input);
    return await installRuntime(ref ?? undefined);
  });
  registerImpl('uninstallBackend', (_event: unknown, input: unknown) =>
    uninstallRuntime(sanitizeLlamaCppBackendRef(input) ?? undefined),
  );
  registerImpl('importRuntime', async () => {
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

    return await runServiceTransition(async () => {
      if (activeRuntimeInstall) throw new Error(LlamaCppBackendError.SwitchRequiresStoppedService);
      return manager.importRuntime(result.filePaths[0], async () => {
        const current = await daemon.reconnect({ requireResponsive: true });
        if (current?.runningModels.length || current?.modelProcesses.length || hasModelWork()) {
          throw new Error(LlamaCppBackendError.SwitchRequiresStoppedService);
        }
        if (current) await stopRuntime(true);
      });
    });
  });
  registerImpl('start', () =>
    runServiceTransition(async () => {
      const status = await daemon.start();
      if (status.status === LlamaCppServiceStatus.Running) {
        const bindingRefresh = await refreshRunningModelBindings({
          preserveExistingWhenEmpty: true,
        });
        if (!bindingRefresh.hasRunningModels) scheduleStartupModelBindingSync();
      }
      return status;
    }),
  );
  registerImpl('stop', () =>
    runServiceTransition(async () => {
      await stopRuntime();
      return {
        status: LlamaCppServiceStatus.Stopped,
        managedByApp: true,
        checkedAt: new Date().toISOString(),
      };
    }),
  );
  registerImpl(
    'restart',
    async () =>
      await runServiceTransition(async () => {
        const status = await suspendBindingReads(() => {
          residency.reset();
          return daemon.restart(resolveServiceConfig());
        });
        await refreshRunningModelBindings();
        return status;
      }),
  );
  registerImpl('getServiceConfig', async () => getLlamaCppServiceConfig(options.getStore()));
  registerImpl('setServiceConfig', (_event: unknown, config: LlamaCppServiceConfig) =>
    runServiceTransition(async () => {
      const store = options.getStore();
      const previous = store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY);
      const sanitized = sanitizeLlamaCppServiceConfig(config);
      if ((previous?.modelsDir?.trim() || '') !== (sanitized.modelsDir || '')) {
        await changeModelsDir(store, previous, sanitized);
      } else {
        store.set(LLAMACPP_SERVICE_CONFIG_KEY, sanitized);
        await daemon.applyConfigIfRunning(sanitized);
      }
      if (isLlamaCppLanAccessEnabled(previous ?? {}) !== isLlamaCppLanAccessEnabled(sanitized)) {
        // The model gateway reads MAGPIE_ADDR only at process start.
        await options.onLanAccessChanged?.();
      }
      return sanitized;
    }),
  );
  registerImpl('getGatewayLanToken', async () => ({
    token: daemon.getLanToken(),
  }));
  registerImpl('regenerateGatewayLanToken', async () => {
    const token = await daemon.regenerateLanToken();
    let lanAccessSynced = false;
    if (isLlamaCppLanAccessEnabled(getLlamaCppServiceConfig(options.getStore()))) {
      try {
        await options.onLanAccessTokenRegenerated?.();
        lanAccessSynced = true;
      } catch (error) {
        console.warn('[LlamaCpp] failed to update the LAN gateway key:', error);
      }
    }
    return { token, lanAccessSynced };
  });
  registerImpl('modelsDir', async () => manager.getModelsDir());
  registerImpl(
    'setModelsDir',
    async (_event: unknown, modelsDir: unknown) =>
      await runServiceTransition(async () => {
        const store = options.getStore();
        const currentConfig = store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY);
        const trimmedModelsDir = typeof modelsDir === 'string' ? modelsDir.trim() : '';
        const nextConfig = sanitizeLlamaCppServiceConfig({
          ...currentConfig,
          modelsDir: trimmedModelsDir || undefined,
        });
        const modelsDirChanged =
          (currentConfig?.modelsDir?.trim() || '') !== (nextConfig.modelsDir || '');
        if (!modelsDirChanged) return manager.getModelsDir();

        await changeModelsDir(store, currentConfig, nextConfig);
        return manager.getModelsDir();
      }),
  );

  registerImpl('listLocalModels', async () => {
    return await manager.listLocalModels();
  });
  registerImpl('listRunningModels', readRunningModels);
  registerImpl('deleteModel', (_event: unknown, name: string) =>
    runServiceTransition(async () => {
      const result = await manager.deleteModel(name, (modelName, modelPath) =>
        residency.withModelUnavailable(modelName, async () => {
          await daemon.deleteModelFile(modelName, modelPath);
          residency.markUnloaded(modelName);
        }),
      );
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
    }),
  );
  registerImpl('getModelPreferences', async () => {
    return getLlamaCppModelPreferences(options.getStore());
  });
  registerImpl('setModelPreference', async (_event: unknown, input: unknown) => {
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
  registerImpl('importModelFiles', async (_event: unknown, input: unknown) => {
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
              runningModelNames: runningModels.map(model =>
                (model.name || model.model || model.id || '').trim(),
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

          const localModels = await manager.listLocalModels(controller.signal);
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
              listRunningModels: () => daemon.listRunningModels(),
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
  const initializeBindings = async () => {
    await routerOrchestrator?.finishDaemonHandoff();
    await refreshRunningModelBindings();
  };
  void runWhileOpen(initializeBindings).catch(error => {
    console.error('[LlamaCpp] Failed to initialize local inference bindings:', error);
  });
  registerImpl('loadModel', async (_event: unknown, input: LlamaCppModelLaunchInput) => {
    if (serviceTransitionLock.isActive()) throw new Error(t('llamacppLoadModelServiceUnavailable'));
    let result: LlamaCppModelLaunchResult | undefined;
    await residency.ensureReady(input.model, async () => {
      result = await loadModelCore(input);
    });
    return result ?? { success: true, runningModels: await readRunningModels() };
  });
  registerImpl('cancelModelLoad', async (_event: unknown, input: unknown) => {
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
  registerImpl('unloadModel', async (_event: unknown, name: string) => {
    const modelName = name.trim();
    if (!modelName) throw new Error('Model name is required');
    const beforeRunningModels = await readRunningModels();
    const unloadingModel = beforeRunningModels.find(
      model => model.name === modelName || model.model === modelName || model.id === modelName,
    );
    const beforeSnapshot = unloadingModel?.size_vram ? await getNvidiaSmiSnapshot() : null;
    await daemon.stopModel(modelName);
    const confirmation = await waitForLlamaCppModelUnloadConfirmation({
      modelName,
      listRunningModels: readRunningModels,
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
  registerImpl('installModel', async (_event: unknown, input: LlamaCppInstallModelInput) => {
    const modelId = input.modelId.trim();
    if (!modelId) throw new Error('Model ID is required');
    if (activeInstalls.size > 0) {
      throw new Error('Another model install is already in progress');
    }
    const controller = new AbortController();
    activeInstalls.set(modelId, controller);
    try {
      await manager.installModel(input, sendProgress, { signal: controller.signal });
      return { success: true };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        sendProgress({
          modelId,
          modelName: input.displayName ?? modelId,
          phase: 'cancelled',
        });
        return { success: false, cancelled: true };
      }
      sendProgress({
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
  registerImpl('cancelInstall', async (_event: unknown, modelId: string) => {
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
  handleIpcContractSubset(
    llamacppContract,
    impls as Parameters<typeof handleIpcContract<typeof llamacppContract>>[1],
  );

  return {
    readModelBindings: (): Promise<LocalGpuSnapshot> =>
      runWhileOpen(async () => {
        const running = await readCurrentBindingState();
        return {
          baseUrl: running?.baseUrl ?? null,
          models: running ? projectBindings(running.runningModels) : [],
        };
      }),
    shutdownForQuit(readyToStop?: Promise<void>) {
      closing = true;
      bindingRefreshGeneration += 1;
      startupBindingSyncGeneration += 1;
      activeModelLoad?.controller.abort();
      runtimeInstallController?.abort();
      for (const controller of activeInstalls.values()) controller.abort();
      residency.dispose();
      const issued = Promise.withResolvers<void>();
      const stopped = (async () => {
        try {
          await readyToStop;
          return daemon.shutdownForQuit();
        } finally {
          // The orchestrator reads its shutdown settings before returning its promise.
          issued.resolve();
        }
      })();
      const drained = Promise.allSettled([issued.promise, ...pending]).then(() => {
        residency.dispose();
      });
      return { drained, stopped };
    },
  };
}

export {
  enforceLlamaCppParallelTwo,
  getLlamaCppModelPreferences,
  getLlamaCppServiceConfig,
  sanitizeLlamaCppModelPreference,
  sanitizeLlamaCppServiceConfig,
  shouldRefreshLlamaCppModelBindings,
} from './config';
