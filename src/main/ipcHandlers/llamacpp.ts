import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';

import type { NvidiaSmiSnapshot } from '../../shared/hardware';
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
} from '../../shared/llamacpp';
import {
  DEFAULT_LLAMACPP_SERVICE_CONFIG,
  LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID,
  getLlamaCppAcceleratorDevices,
  getLlamaCppModelsMaxLimitViolation,
  LLAMACPP_GPU_LAYERS_MAX,
  LLAMACPP_STRUCTURED_INTEGER_RANGES,
  LlamaCppIpcChannel,
  LlamaCppGatewayAccessMode,
  LlamaCppModelLaunchLogPhase,
  LlamaCppRuntimeBackend,
  LlamaCppRuntimeCudaMajor,
  LlamaCppMemoryPolicy,
  LlamaCppModelResidencyMode,
  LlamaCppStructuredServiceFieldKey,
} from '../../shared/llamacpp';
import {
  ModelCapabilityStatus,
  parseLlamaCppRuntimeCapabilities,
  type ModelCapabilities,
} from '../../shared/providers';
import { t } from '../i18n';
import { updateLlamaCppRunningModels } from '../libs/claudeSettings';
import { LlamaCppManager, resolveLlamaCppDeviceSelection } from '../libs/llamacppManager';
import { createLlamaCppModelLaunchLogger } from '../libs/llamacppModelLaunchLog';
import {
  classifyLlamaCppModelLoadError,
  getLlamaCppModelLoadFailureI18nKey,
  LlamaCppModelLoadFailureReason,
} from '../libs/llamacppModelLoadErrors';
import { LlamaCppModelLoadLock } from '../libs/llamacppModelLoadLock';
import { LlamaCppModelDaemonController } from '../libs/llamacppModelDaemonController';
import { loadLlamaCppModelThroughPipeline } from '../libs/llamacppModelLoadPipeline';
import {
  LlamaCppModelResidencyManager,
  LlamaCppModelResidencyState,
  type LlamaCppModelResidencySnapshot,
} from '../libs/llamacppModelResidencyManager';
import { createLlamaCppRuntimeInstallState } from '../libs/llamacppRuntimeInstallState';
import {
  buildLlamaCppRunningModelBinding,
  type LlamaCppAgentAppConfig,
  removeLlamaCppModelFromAppConfig,
  upsertLlamaCppProviderInAppConfig,
} from '../libs/llamacppAgentBinding';
import { applyLlamaCppServiceTransition } from '../libs/llamacppServiceTransition';
import { LlamaCppServiceTransitionLock } from '../libs/llamacppServiceTransitionLock';
import { getNvidiaSmiSnapshot } from '../libs/nvidiaSmi';
import { getSystemMemorySnapshot } from '../libs/systemMemory';
import type { SqliteStore } from '../sqliteStore';
import { registerLlamaCppModelLaunchLogIpcHandlers } from './llamacppModelLaunchLogs';

const LLAMACPP_SERVICE_CONFIG_KEY = 'llamacpp_service_config';
const OLLAMA_SERVICE_CONFIG_KEY = 'ollama_service_config';
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
] as const satisfies ReadonlyArray<keyof ModelCapabilities>;

const LlamaCppServiceStatus = {
  Running: 'running',
  Stopped: 'stopped',
} as const;

type LlamaCppModelBindingRefreshResult = {
  changed: boolean;
  hasRunningModels: boolean;
};

function broadcastLlamaCppModelResidencyState(
  broadcast: (channel: string, payload: unknown) => void,
  snapshot: LlamaCppModelResidencySnapshot,
): void {
  broadcast(LlamaCppIpcChannel.ModelResidencyChanged, snapshot);
}

export async function waitForLlamaCppStartupModelBindings(input: {
  refresh: () => Promise<boolean>;
  isCurrent: () => boolean;
  attempts?: number;
  intervalMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<void> {
  const attempts = Math.max(1, input.attempts ?? LLAMACPP_STARTUP_BINDING_SYNC_ATTEMPTS);
  const intervalMs = input.intervalMs ?? LLAMACPP_STARTUP_BINDING_SYNC_INTERVAL_MS;
  const wait = input.wait ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));

  for (let attempt = 0; attempt < attempts && input.isCurrent(); attempt += 1) {
    if (await input.refresh()) return;
    if (attempt < attempts - 1 && input.isCurrent()) {
      await wait(intervalMs);
    }
  }
}

const LLAMACPP_SANITIZED_NUMERIC_DEFAULTS = {
  modelsMax: DEFAULT_LLAMACPP_SERVICE_CONFIG.modelsMax ?? '0',
  timeout: DEFAULT_LLAMACPP_SERVICE_CONFIG.timeout ?? '120',
  threadsHttp: DEFAULT_LLAMACPP_SERVICE_CONFIG.threadsHttp ?? '4',
  cacheReuse: DEFAULT_LLAMACPP_SERVICE_CONFIG.cacheReuse ?? '256',
  cacheRam: DEFAULT_LLAMACPP_SERVICE_CONFIG.cacheRam ?? '8192',
  ctxSize: DEFAULT_LLAMACPP_SERVICE_CONFIG.ctxSize ?? '4096',
  parallel: DEFAULT_LLAMACPP_SERVICE_CONFIG.parallel ?? '2',
  batchSize: DEFAULT_LLAMACPP_SERVICE_CONFIG.batchSize ?? '512',
  ubatchSize: DEFAULT_LLAMACPP_SERVICE_CONFIG.ubatchSize ?? '512',
  gpuLayers: DEFAULT_LLAMACPP_SERVICE_CONFIG.gpuLayers ?? 'auto',
  threads: DEFAULT_LLAMACPP_SERVICE_CONFIG.threads ?? '-1',
  threadsBatch: DEFAULT_LLAMACPP_SERVICE_CONFIG.threadsBatch ?? '-1',
  mainGpu: DEFAULT_LLAMACPP_SERVICE_CONFIG.mainGpu ?? '0',
} as const;

const LLAMACPP_MEMORY_BUDGET_PERCENT_RANGE = { min: 10, max: 90 } as const;

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
        input.runningModels.map(model => (model.name || model.model || '').trim()).filter(Boolean),
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

function throwIfLlamaCppModelLoadCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
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
  },
): LlamaCppModelDaemonController {
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
    const cacheChanged = updateLlamaCppRunningModels(bindingModels);
    const current = store.get<LlamaCppAgentAppConfig>('app_config') ?? {};
    // Persist the same endpoint that the managed service uses, including a user-selected port.
    const appConfigUpdate = upsertLlamaCppProviderInAppConfig(
      current,
      bindingModels,
      getLlamaCppServiceConfig(store),
      daemon.gatewayBaseUrl() ?? undefined,
    );
    if (appConfigUpdate.changed) {
      store.set('app_config', appConfigUpdate.config);
    }
    const changed = cacheChanged || appConfigUpdate.changed;
    if (changed) {
      broadcast(LlamaCppIpcChannel.ModelBindingsChanged, undefined);
    }
    return changed;
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
      // A transient runtime read failure must not erase persisted model settings.
      console.warn('[LlamaCpp] skipped model binding refresh because running models could not be read:', error);
      return { changed: false, hasRunningModels: false };
    }
  };

  const sendProgress = (progress: LlamaCppInstallProgress) =>
    broadcast(LlamaCppIpcChannel.InstallProgress, progress);
  const { sendModelLaunchLog } = registerLlamaCppModelLaunchLogIpcHandlers({
    broadcast,
  });
  const daemon = new LlamaCppModelDaemonController({
    userDataPath: app.getPath('userData'),
    getStore: options.getStore,
    getServiceConfig: () => {
      const config = getLlamaCppServiceConfig(options.getStore());
      return {
        ...config,
        modelsDir: config.modelsDir?.trim() || manager.getModelsDir(),
      };
    },
  });
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
    const current = store.get<LlamaCppAgentAppConfig>('app_config');
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
    if (
      modelName &&
      shouldRefreshLlamaCppModelBindings(current[modelName], next[modelName])
    ) {
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
          const runningModels = await daemon.listRunningModels();
          throwIfLlamaCppModelLoadCancelled(controller.signal);
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
              launchInput: { ...inputWithPreferences, model: modelName, modelPath: targetModel.path },
              runtimeBackend: serviceConfig.runtimeBackend,
              runtimeCapabilities,
              nvidiaSnapshot,
              systemMemorySnapshot: getSystemMemorySnapshot(),
              memoryPolicy: serviceConfig.memoryPolicy,
              memoryBudgetPercent: serviceConfig.memoryBudgetPercent,
              modelSizeBytes: targetModel.size,
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
  void daemon.reconnect().then(() => refreshRunningModelBindings()).catch(error => {
    console.error('[LlamaCppDaemon] failed to reconnect to local inference daemon:', error);
  });
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

export function getLlamaCppServiceConfig(store: SqliteStore): LlamaCppServiceConfig {
  return sanitizeLlamaCppServiceConfig({
    ...DEFAULT_LLAMACPP_SERVICE_CONFIG,
    ...(store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY) ?? {}),
  });
}

export function getLlamaCppModelPreferences(store: SqliteStore): LlamaCppModelPreferences {
  return sanitizeLlamaCppModelPreferences(
    store.get<LlamaCppModelPreferences>(LLAMACPP_MODEL_PREFERENCES_KEY),
  );
}

function migrateLegacyLlamaCppConfig(store: SqliteStore): void {
  migrateLegacyServiceConfig(store);
  enforceLlamaCppParallelTwo(store);
}

export function enforceLlamaCppParallelTwo(store: SqliteStore): void {
  const existing = store.get<LlamaCppServiceConfig>(LLAMACPP_SERVICE_CONFIG_KEY);
  if (!existing || existing.parallel === '2') return;
  store.set(LLAMACPP_SERVICE_CONFIG_KEY, { ...existing, parallel: '2' });
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

function getLlamaCppModelPreferenceInputName(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const modelName = (input as LlamaCppSetModelPreferenceInput).modelName;
  const normalizedModelName = typeof modelName === 'string' ? modelName.trim() : '';
  return normalizedModelName || null;
}

export function shouldRefreshLlamaCppModelBindings(
  previous: LlamaCppModelPreference | undefined,
  next: LlamaCppModelPreference | undefined,
): boolean {
  if (previous?.ctxSize !== next?.ctxSize || previous?.maxTokens !== next?.maxTokens) {
    return true;
  }
  return LLAMACPP_MODEL_PREFERENCE_CAPABILITY_KEYS.some(
    key => previous?.capabilities?.[key] !== next?.capabilities?.[key],
  );
}

export function sanitizeLlamaCppModelPreference(
  preference: unknown,
): LlamaCppModelPreference | null {
  if (!preference || typeof preference !== 'object') {
    return null;
  }

  const candidate = preference as {
    ctxSize?: unknown;
    maxTokens?: unknown;
    capabilities?: Record<string, unknown>;
    residency?: { mode?: unknown; idleMinutes?: unknown };
  };
  const parsedCtxSize =
    typeof candidate.ctxSize === 'number'
      ? candidate.ctxSize
      : typeof candidate.ctxSize === 'string'
        ? Number.parseInt(candidate.ctxSize, 10)
        : undefined;
  const ctxSizeRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CtxSize];

  const ctxSize =
    typeof parsedCtxSize === 'number' &&
    Number.isFinite(parsedCtxSize) &&
    parsedCtxSize >= ctxSizeRange.min &&
    parsedCtxSize <= ctxSizeRange.max
      ? parsedCtxSize
      : undefined;
  const parsedMaxTokens =
    typeof candidate.maxTokens === 'number'
      ? candidate.maxTokens
      : typeof candidate.maxTokens === 'string'
        ? Number.parseInt(candidate.maxTokens, 10)
        : undefined;
  const maxTokens =
    typeof parsedMaxTokens === 'number' &&
    Number.isSafeInteger(parsedMaxTokens) &&
    parsedMaxTokens > 0
      ? parsedMaxTokens
      : undefined;
  const capabilities = Object.fromEntries(
    LLAMACPP_MODEL_PREFERENCE_CAPABILITY_KEYS.flatMap(key => {
      const status = candidate.capabilities?.[key];
      return status === ModelCapabilityStatus.Supported ||
        status === ModelCapabilityStatus.Unsupported ||
        status === ModelCapabilityStatus.Unknown
        ? [[key, status]]
        : [];
    }),
  ) as Partial<ModelCapabilities>;
  const residency =
    candidate.residency?.mode === LlamaCppModelResidencyMode.Forever
      ? { mode: LlamaCppModelResidencyMode.Forever }
      : candidate.residency?.mode === LlamaCppModelResidencyMode.Timed &&
          typeof candidate.residency.idleMinutes === 'number' &&
          Number.isSafeInteger(candidate.residency.idleMinutes) &&
          candidate.residency.idleMinutes >= 0 &&
          candidate.residency.idleMinutes <= 10_080
        ? {
            mode: LlamaCppModelResidencyMode.Timed,
            idleMinutes: candidate.residency.idleMinutes,
          }
        : undefined;

  return ctxSize || maxTokens || Object.keys(capabilities).length > 0 || residency
    ? {
        ...(ctxSize ? { ctxSize } : {}),
        ...(maxTokens ? { maxTokens } : {}),
        ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
        ...(residency ? { residency } : {}),
      }
    : null;
}

export function sanitizeLlamaCppServiceConfig(
  config: LlamaCppServiceConfig | undefined,
  runtimeDevices?: {
    success: boolean;
    devices?: Array<{ id?: string; name?: string }>;
  } | null,
): LlamaCppServiceConfig {
  const next: LlamaCppServiceConfig = {};
  const modelsMaxRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.ModelsMax];
  const timeoutRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.Timeout];
  const threadsHttpRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.ThreadsHttp];
  const cacheReuseRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CacheReuse];
  const cacheRamRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CacheRam];
  const ctxSizeRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.CtxSize];
  const parallelRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.Parallel];
  const batchSizeRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.BatchSize];
  const ubatchSizeRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.UbatchSize];
  const threadsRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.Threads];
  const threadsBatchRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.ThreadsBatch];
  const mainGpuRange =
    LLAMACPP_STRUCTURED_INTEGER_RANGES[LlamaCppStructuredServiceFieldKey.MainGpu];
  const host = config?.host?.trim();
  const listenHost = config?.listenHost?.trim();
  const gatewayAccessMode = config?.gatewayAccessMode;
  const port = normalizeIntegerString(config?.port);
  const modelsDir = config?.modelsDir?.trim();
  const runtimeVersion = config?.runtimeVersion?.trim();
  const runtimeBackend = config?.runtimeBackend;
  const runtimeCudaMajor = config?.runtimeCudaMajor;
  const memoryPolicy = config?.memoryPolicy;
  const memoryBudgetPercent = normalizeIntegerNumber(config?.memoryBudgetPercent, {
    min: LLAMACPP_MEMORY_BUDGET_PERCENT_RANGE.min,
    max: LLAMACPP_MEMORY_BUDGET_PERCENT_RANGE.max,
  });
  const sanitizedModelsMax = normalizeIntegerStringWithDefault(config?.modelsMax, {
    min: modelsMaxRange.min,
    max: modelsMaxRange.max,
    defaultValue: LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.modelsMax,
  });
  const modelsMax =
    sanitizedModelsMax === '0' ? LLAMACPP_SANITIZED_NUMERIC_DEFAULTS.modelsMax : sanitizedModelsMax;
  const modelsAutoload = config?.modelsAutoload as unknown;
  const keepRunningOnAppQuit = config?.keepRunningOnAppQuit as unknown;
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
  if (
    gatewayAccessMode === LlamaCppGatewayAccessMode.Local ||
    gatewayAccessMode === LlamaCppGatewayAccessMode.Lan
  ) {
    next.gatewayAccessMode = gatewayAccessMode;
  }
  if (port) next.port = port;
  if (modelsDir) next.modelsDir = modelsDir;
  if (runtimeVersion && /^b\d+(?:-[a-f0-9]+)?$/i.test(runtimeVersion))
    next.runtimeVersion = runtimeVersion;
  if (isRuntimeBackend(runtimeBackend)) next.runtimeBackend = runtimeBackend;
  if (isRuntimeCudaMajor(runtimeCudaMajor)) next.runtimeCudaMajor = runtimeCudaMajor;
  if (memoryPolicy === LlamaCppMemoryPolicy.Auto || memoryPolicy === LlamaCppMemoryPolicy.Manual) {
    next.memoryPolicy = memoryPolicy;
  }
  if (memoryBudgetPercent !== undefined) next.memoryBudgetPercent = memoryBudgetPercent;
  if (modelsMax) next.modelsMax = modelsMax;
  if (modelsAutoload !== undefined && modelsMax === '1') {
    if (typeof modelsAutoload === 'boolean') next.modelsAutoload = modelsAutoload;
    if (modelsAutoload === 'true') next.modelsAutoload = true;
    if (modelsAutoload === 'false') next.modelsAutoload = false;
  } else if (modelsAutoload !== undefined) {
    next.modelsAutoload = false;
  }
  if (typeof keepRunningOnAppQuit === 'boolean') {
    next.keepRunningOnAppQuit = keepRunningOnAppQuit;
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
  if (typeof config?.kvUnified === 'boolean') next.kvUnified = config.kvUnified;
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

function sanitizeLlamaCppBackendRef(
  input: unknown,
): { version: string; backend: string; versionBackend: string } | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as { version?: unknown; backend?: unknown; versionBackend?: unknown };
  let version = typeof candidate.version === 'string' ? candidate.version.trim() : '';
  let backend = typeof candidate.backend === 'string' ? candidate.backend.trim() : '';
  const versionBackend =
    typeof candidate.versionBackend === 'string' ? candidate.versionBackend.trim() : '';
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

function normalizeIntegerNumber(
  value: number | undefined,
  range: { min: number; max: number },
): number | undefined {
  if (!Number.isInteger(value)) return undefined;
  if (value < range.min || value > range.max) return undefined;
  return value;
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

  if (
    !runtimeDevices?.success ||
    !Array.isArray(runtimeDevices.devices) ||
    runtimeDevices.devices.length === 0
  ) {
    const tokens = trimmed
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
    if (tokens.length === 0) return undefined;

    const normalizedTokens = tokens.map(token => (/^[A-Za-z0-9_.:-]+$/.test(token) ? token : ''));
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

function isRuntimeBackend(
  value: unknown,
): value is NonNullable<LlamaCppServiceConfig['runtimeBackend']> {
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
