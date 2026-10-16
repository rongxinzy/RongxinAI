import { type ChildProcess, spawn } from 'child_process';
import { app, net } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import type {
  LlamaCppBackendListResult,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchResult,
  LlamaCppRunningModel,
  LlamaCppRuntimeCapabilities,
  LlamaCppRuntimeImportResult,
  LlamaCppRuntimeInstallResult,
  LlamaCppRuntimeListDevicesResult,
  LlamaCppRuntimeUninstallResult,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import type { LlamaCppBackendRef } from '../../shared/llamacpp';
import {
  applyAutomaticLlamaCppServiceDefaults,
  isLikelyCudaDriverMismatchError,
  LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID,
  resolveLlamaCppLaunchContext,
} from '../../shared/llamacpp';
import {
  fetchLlamaCppBackendManifest,
  getLlamaCppBackendCompatibilityError,
  getLlamaCppBackendExecutablePath,
  getLlamaCppCurrentExecutablePath,
  importLlamaCppBackendPath,
  installLlamaCppBackend,
  listLlamaCppBackends,
  readCurrentBackendRef,
  recommendLlamaCppBackend,
  recommendLlamaCppCpuBackend,
  resolveLlamaCppBackendDownloadSize,
  syncCurrentBackend,
  uninstallLlamaCppBackend,
} from './llamacppBackendManager';
import {
  backendRequiresDeviceValidation,
  validateBackendDevices,
} from './llamacppBackendValidation';
import {
  prepareLlamaCppBackendVersionSwitch,
  restartLlamaCppBackendVersionService,
} from './llamacppBackendVersionSwitch';
import {
  readBundledLlamaCppRuntimeManifest,
  resolveBundledLlamaCppExecutablePath,
} from './llamacppBundledRuntime';
import {
  isVulkanBackendStartupFailure,
  resolveBundledEditionRuntime,
  type ResolvedBundledRuntime,
} from './llamacppBundledRuntimeSelection';
import {
  primaryGpuSupportsCudaEdition,
  resolveCudaEditionGpuMessage,
  shouldEnforceCudaEditionGpuPolicy,
} from './llamacppCudaEditionPolicy';
import {
  isLocalInferenceFeatureEnabled,
  usesBundledLlamaCppRuntime,
} from './inferenceEditionPolicy';
import { LlamaCppClient } from './llamacppClient';
import { isPathInside, mergeLocalModels, scanLocalGgufModels } from './llamacppModelCatalog';
import {
  installModelOnce,
  isModelDownloadNotFoundError,
  isSameInstallRequest,
  prefillInstallInputFromMarketplace,
  refreshInstallInputFromMarketplace,
  resolveManagedModelInstallDir,
} from './llamacppModelInstallation';
import { getDefaultLlamaCppModelsDir } from './llamacppModelLibraryPath';
import {
  createLlamaCppServerSpawnOptions,
  shouldKeepLlamaCppServiceRunning,
} from './llamacppProcessLifecycle';
import { retryLlamaCppReadRequest } from './llamacppRequestRetry';
import {
  createLlamaCppRuntimeInstallPlan,
  executeLlamaCppRuntimeInstallPlan,
  resolveLlamaCppExecutableName,
} from './llamacppRuntimeInstaller';
import {
  findExternalLlamaCppExecutable,
  findLlamaCppExecutable,
  getUserLlamaCppRuntimeRoot,
  resolveLlamaCppRuntimeMetadata,
} from './llamacppRuntimePaths';
import {
  buildLlamaCppServeEnv,
  buildLlamaCppServiceConfigFieldSupport,
  buildLlamaServerArgs,
  filterLlamaCppServiceConfigByRuntimeCapabilities,
  isGpuLikeRuntimeDevice,
  listLlamaCppRuntimeHelpFlags,
  resolveLlamaCppDeviceSelection,
  shouldEnableLlamaCppModelsAutoload,
} from './llamacppServe';
import { listLlamaCppRuntimeDevices } from './llamacppRuntimeDeviceProbe';
import { MarketplaceService } from './marketplaceService';
import { getLlamaCppNvidiaSnapshot, hasAvailableNvidiaGpu } from './llamacppNvidiaEnvironment';
import { t } from '../i18n';
import { normalizePositiveInteger } from './llamacppManagerFileUtils';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = '8080';
const DEFAULT_CONNECTION_AND_LOAD_TIMEOUT_MS = 120_000;
export const LLAMACPP_RUNNING_MODELS_DEFAULT_TIMEOUT_MS = 2_000;
export const QUIT_RUNNING_MODELS_TIMEOUT_MS = 1500;
export const QUIT_UNLOAD_MODEL_TIMEOUT_MS = 3000;
export const LLAMACPP_RUNTIME_PROGRESS_KEY = LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID;
export const LLAMACPP_LAST_LOADED_MODEL_KEY = 'llamacpp_last_loaded_model';
const LLAMACPP_BACKEND_LIST_CACHE_TTL_MS = 60_000;

type RequestOptions = { signal?: AbortSignal };

type LlamaCppBackendListCacheEntry = {
  key: string;
  expiresAt: number;
  result: LlamaCppBackendListResult;
};

type LlamaCppManagerStorage = {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
};

export const LlamaCppManagerLifecycleEvent = {
  ModelsUnloadedForQuit: 'models-unloaded-for-quit',
  ProcessOutput: 'process-output',
} as const;

export type LlamaCppManagerLifecycleEvent =
  (typeof LlamaCppManagerLifecycleEvent)[keyof typeof LlamaCppManagerLifecycleEvent];

export const LlamaCppProcessOutputStream = {
  Stdout: 'stdout',
  Stderr: 'stderr',
} as const;

export type LlamaCppProcessOutputStream =
  (typeof LlamaCppProcessOutputStream)[keyof typeof LlamaCppProcessOutputStream];

export type LlamaCppProcessOutputEvent = {
  stream: LlamaCppProcessOutputStream;
  text: string;
  createdAt: string;
  pid?: number;
};

export type LlamaCppModelsUnloadedForQuitEvent = {
  modelNames: string[];
};

export class LlamaCppManagerCore extends EventEmitter {
  protected executablePath: string | null = null;
  protected bundledRuntimeSelection: ResolvedBundledRuntime | undefined;
  protected bundledStartupCpuFallbackAttempted = false;
  protected process: ChildProcess | null = null;
  protected runtimeContextLengthByModel = new Map<string, number>();
  protected thinkingToggleSupportByModel = new Map<string, boolean>();
  protected startupStderr = '';
  protected readonly marketplaceService: MarketplaceService;
  protected readonly storage?: LlamaCppManagerStorage;
  protected backendListCache: LlamaCppBackendListCacheEntry | null = null;
  /** Message of the last router-listing failure; repeats stay at debug level. */
  protected routerListFailure: string | null = null;
  protected status: LlamaCppStatusSnapshot = {
    status: 'unknown',
    checkedAt: new Date().toISOString(),
  };

  constructor(
    protected readonly getServiceConfig: () => LlamaCppServiceConfig = () => ({}),
    marketplaceService?: MarketplaceService,
    storage?: LlamaCppManagerStorage,
  ) {
    super();
    this.marketplaceService =
      marketplaceService ??
      new MarketplaceService(() => this.getModelsDir(), {
        fetchImpl: net.fetch,
        cacheDir: path.join(app.getPath('userData'), 'marketplace-cache'),
      });
    this.storage = storage;
  }

  getStatus(): LlamaCppStatusSnapshot {
    return this.status;
  }

  protected handleProcessOutput(stream: LlamaCppProcessOutputStream, chunk: Buffer): string {
    const text = chunk.toString().trim();
    if (!text) return '';

    if (stream === LlamaCppProcessOutputStream.Stdout) {
      console.debug(`[LlamaCpp] ${text}`);
    } else {
      console.warn(`[LlamaCpp] ${text}`);
    }

    this.emit(LlamaCppManagerLifecycleEvent.ProcessOutput, {
      stream,
      text,
      createdAt: new Date().toISOString(),
      ...(this.process?.pid ? { pid: this.process.pid } : {}),
    } satisfies LlamaCppProcessOutputEvent);

    return text;
  }

  getBaseUrl(): string {
    const config = this.getServiceConfig();
    const host =
      config.host?.trim() === '0.0.0.0' ? DEFAULT_HOST : config.host?.trim() || DEFAULT_HOST;
    const port = config.port?.trim() || DEFAULT_PORT;
    return `http://${host}:${port}`;
  }

  getModelsDir(): string {
    return (
      this.getServiceConfig().modelsDir?.trim() ||
      getDefaultLlamaCppModelsDir({
        platform: process.platform,
        appDataPath: app.getPath('appData'),
        userDataPath: app.getPath('userData'),
        localAppDataPath: process.env.LOCALAPPDATA,
      })
    );
  }

  initializeModelsDir(): string {
    const modelsDir = this.getModelsDir();
    fs.mkdirSync(modelsDir, { recursive: true });
    return modelsDir;
  }

  getPresetPath(): string {
    return path.join(app.getPath('userData'), 'llamacpp', 'models-preset.ini');
  }

  getConnectionAndLoadTimeoutMs(): number {
    const configuredSeconds = normalizePositiveInteger(this.getServiceConfig().timeout);
    if (!configuredSeconds) return DEFAULT_CONNECTION_AND_LOAD_TIMEOUT_MS;
    return configuredSeconds * 1000;
  }

  protected getBackendListCacheKey(): string {
    const config = this.getServiceConfig();
    return [
      process.platform,
      process.arch,
      config.runtimeVersion?.trim() ?? '',
      config.runtimeBackend ?? '',
    ].join(':');
  }

  protected clearBackendListCache(): void {
    this.backendListCache = null;
  }

  protected async resolveRuntimeServiceConfig(): Promise<LlamaCppServiceConfig> {
    const config = this.getServiceConfig();
    const requestedDevice = config.device?.trim();
    if (!requestedDevice) return config;

    try {
      const runtimeDevices = await this.listRuntimeDevices();
      if (!runtimeDevices.success || runtimeDevices.devices.length === 0) {
        return config;
      }
      return {
        ...config,
        device: resolveLlamaCppDeviceSelection(requestedDevice, runtimeDevices.devices),
      };
    } catch {
      return config;
    }
  }

  async detect(): Promise<LlamaCppStatusSnapshot> {
    const client = new LlamaCppClient(this.getBaseUrl());
    try {
      const version = await client.version(300);
      this.setStatus({
        status: 'running',
        version: version.version,
        executablePath: this.executablePath ?? undefined,
        pid: this.process?.pid,
        managedByApp: Boolean(this.process),
      });
      return this.status;
    } catch {
      // Continue with executable detection.
    }

    const executablePath = await findLlamaCppExecutable(this.getServiceConfig());
    this.executablePath = executablePath;
    this.setStatus({
      status: executablePath ? 'installed' : 'not-installed',
      executablePath: executablePath ?? undefined,
      managedByApp: false,
    });
    return this.status;
  }

  async start(): Promise<LlamaCppStatusSnapshot> {
    if (await this.isHealthy()) return this.status;

    if (!this.executablePath) {
      this.executablePath = await findLlamaCppExecutable(this.getServiceConfig());
    }
    if (!this.executablePath) {
      this.setStatus({ status: 'not-installed', managedByApp: false });
      return this.status;
    }

    fs.mkdirSync(this.getModelsDir(), { recursive: true });
    fs.mkdirSync(path.dirname(this.getPresetPath()), { recursive: true });
    if (!fs.existsSync(this.getPresetPath())) {
      fs.writeFileSync(this.getPresetPath(), 'version = 1\n\n', 'utf-8');
    }

    const runtimeConfig = await this.resolveRuntimeServiceConfig();
    const nvidiaSnapshot = await getLlamaCppNvidiaSnapshot();
    const resolvedRuntimeConfig = applyAutomaticLlamaCppServiceDefaults(runtimeConfig, {
      nvidiaSnapshot,
    });
    const runtimeCapabilities = await this.getRuntimeCapabilities().catch((): null => null);
    const filteredRuntimeConfig = filterLlamaCppServiceConfigByRuntimeCapabilities(
      resolvedRuntimeConfig,
      runtimeCapabilities,
    );
    this.setStatus({ status: 'starting', executablePath: this.executablePath, managedByApp: true });
    const keepRunningOnAppQuit = shouldKeepLlamaCppServiceRunning(filteredRuntimeConfig);
    const serviceProcess = spawn(
      this.executablePath,
      buildLlamaServerArgs(filteredRuntimeConfig, this.getModelsDir(), this.getPresetPath()),
      createLlamaCppServerSpawnOptions({
        config: filteredRuntimeConfig,
        env: buildLlamaCppServeEnv(process.env, this.executablePath, process.platform),
      }),
    );
    this.process = serviceProcess;
    if (keepRunningOnAppQuit) serviceProcess.unref();

    this.startupStderr = '';
    serviceProcess.stdout?.on('data', chunk => {
      this.handleProcessOutput(LlamaCppProcessOutputStream.Stdout, chunk);
    });
    serviceProcess.stderr?.on('data', chunk => {
      const text = this.handleProcessOutput(LlamaCppProcessOutputStream.Stderr, chunk);
      if (!text) return;
      this.startupStderr += (this.startupStderr ? '\n' : '') + text;
    });
    serviceProcess.on('exit', (code, signal) => {
      console.log(
        `[LlamaCpp] process exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`,
      );
      this.process = null;
      if (this.status.status === 'starting') {
        const exitDetail = this.formatStartupExitDetail(code, signal);
        const stderrSnippet = this.startupStderr
          ? `: ${this.startupStderr.slice(0, 300)} (${exitDetail})`
          : ` (${exitDetail})`;
        this.setStatus({
          status: 'error',
          error: `llama.cpp exited unexpectedly during startup${stderrSnippet}`,
          executablePath: this.executablePath ?? undefined,
          managedByApp: false,
        });
        return;
      }
      if (this.status.status === 'running') {
        this.setStatus({
          status: 'stopped',
          executablePath: this.executablePath ?? undefined,
          managedByApp: false,
        });
      }
    });
    serviceProcess.on('error', error => {
      console.warn('[LlamaCpp] process failed:', error);
      this.setStatus({
        status: 'error',
        error: error.message,
        executablePath: this.executablePath ?? undefined,
        managedByApp: false,
      });
    });

    await Promise.race([
      this.waitUntilHealthy(this.getConnectionAndLoadTimeoutMs()),
      this.waitForStartupProcessExit(serviceProcess),
    ]);
    if (
      usesBundledLlamaCppRuntime() &&
      !this.bundledStartupCpuFallbackAttempted &&
      this.bundledRuntimeSelection?.accelerator === 'vulkan' &&
      this.status.status === 'error'
    ) {
      const manifest = readBundledLlamaCppRuntimeManifest();
      const startupError = this.status.error ?? this.startupStderr;
      if (
        manifest?.cpuFallbackExecutable &&
        (isVulkanBackendStartupFailure(startupError) ||
          /backend.*(?:unavailable|not available|failed)/i.test(startupError ?? ''))
      ) {
        this.bundledStartupCpuFallbackAttempted = true;
        try {
          const cpuResolved = await resolveBundledEditionRuntime({
            manifest,
            forceCpuPath: true,
          });
          this.bundledRuntimeSelection = cpuResolved;
          this.executablePath = cpuResolved.executablePath;
          syncCurrentBackend(getUserLlamaCppRuntimeRoot(), cpuResolved.backend);
          console.warn('[LlamaCpp] Vulkan startup failed; falling back to bundled CPU runtime.');
          return this.start();
        } catch (error) {
          console.warn('[LlamaCpp] Bundled CPU fallback failed:', error);
        }
      }
    }
    return this.status;
  }

  async installRuntime(
    options: { signal?: AbortSignal } = {},
  ): Promise<LlamaCppRuntimeInstallResult> {
    if (!isLocalInferenceFeatureEnabled()) {
      const error = 'Local inference is not included in this edition.';
      this.setStatus({ status: 'not-installed', managedByApp: false, error });
      return { success: false, plan: { kind: 'needs-manual', message: error }, error };
    }
    this.clearBackendListCache();
    this.emit('install-progress', {
      phase: 'starting',
      modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
      modelName: 'llama.cpp runtime',
    } satisfies LlamaCppInstallProgress);
    const config = this.getServiceConfig();
    if (usesBundledLlamaCppRuntime()) {
      return await this.installBundledRuntime(options);
    }
    const externalExecutablePath = await findExternalLlamaCppExecutable(config);
    if (externalExecutablePath) {
      const plan = createLlamaCppRuntimeInstallPlan({
        platform: process.platform,
        arch: process.arch,
        isPackaged: app.isPackaged,
        existingExecutablePath: externalExecutablePath,
        userRuntimeRoot: getUserLlamaCppRuntimeRoot(),
      });
      const result = await executeLlamaCppRuntimeInstallPlan(plan);
      this.executablePath = result.executablePath ?? externalExecutablePath;
      this.setStatus({
        status: result.success ? 'installed' : 'not-installed',
        executablePath: this.executablePath,
        managedByApp: false,
        error: result.error,
      });
      this.emit('install-progress', {
        phase: result.success ? 'done' : 'failed',
        modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
        modelName: 'llama.cpp runtime',
        ...(result.success ? { percent: 100 } : { error: result.error }),
      } satisfies LlamaCppInstallProgress);
      return result;
    }

    const runtimeRoot = getUserLlamaCppRuntimeRoot();
    const nvidiaSnapshot = await getLlamaCppNvidiaSnapshot();
    const manifest = await fetchLlamaCppBackendManifest();
    let ref = recommendLlamaCppBackend({
      manifest,
      platform: process.platform,
      arch: process.arch,
      hasNvidiaGpu: hasAvailableNvidiaGpu(nvidiaSnapshot),
      config,
      driverVersion: nvidiaSnapshot?.driverVersion,
    });
    if (!ref) {
      const error = `Unsupported platform for llama.cpp runtime: ${process.platform}/${process.arch}.`;
      this.setStatus({
        status: 'not-installed',
        executablePath: this.executablePath ?? undefined,
        managedByApp: false,
        error,
      });
      return {
        success: false,
        plan: { kind: 'needs-manual', message: error },
        error,
      };
    }
    this.setStatus({
      status: this.status.status,
      executablePath: this.executablePath ?? undefined,
      managedByApp: false,
      error: undefined,
    });
    this.emit('install-progress', {
      phase: 'downloading',
      modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
      modelName: ref.versionBackend,
    } satisfies LlamaCppInstallProgress);

    let result = await installLlamaCppBackend({
      runtimeRoot,
      ref,
      platform: process.platform,
      arch: process.arch,
      hasNvidiaGpu: hasAvailableNvidiaGpu(nvidiaSnapshot),
      manifest,
      switchCurrent: false,
      signal: options.signal,
      onProgress: progress => {
        this.emit('install-progress', {
          ...progress,
          modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
          modelName: ref!.versionBackend,
        } satisfies LlamaCppInstallProgress);
      },
    });

    let installWarning: string | undefined;
    if (!result.success && ref.backend.includes('cuda') && !options.signal?.aborted) {
      const cpuRef = recommendLlamaCppCpuBackend({
        manifest,
        platform: process.platform,
        arch: process.arch,
        config,
      });
      if (cpuRef && cpuRef.versionBackend !== ref.versionBackend) {
        installWarning = isLikelyCudaDriverMismatchError(result.error)
          ? t('llamacppCudaBackendFallbackCpuDriver')
          : t('llamacppCudaBackendFallbackCpu');
        ref = cpuRef;
        result = await installLlamaCppBackend({
          runtimeRoot,
          ref: cpuRef,
          platform: process.platform,
          arch: process.arch,
          hasNvidiaGpu: false,
          manifest,
          switchCurrent: false,
          signal: options.signal,
          onProgress: progress => {
            this.emit('install-progress', {
              ...progress,
              modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
              modelName: cpuRef.versionBackend,
            } satisfies LlamaCppInstallProgress);
          },
        });
      }
    }

    if (result.success && result.executablePath) {
      if (backendRequiresDeviceValidation(ref)) {
        const deviceResult = await this.listRuntimeDevices(ref);
        if (!deviceResult.success) {
          this.setStatus({
            status: 'not-installed',
            executablePath: undefined,
            managedByApp: false,
            error: deviceResult.error || 'Backend device validation failed.',
          });
          this.emit('install-progress', {
            phase: 'failed',
            modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
            modelName: ref.versionBackend,
            error: deviceResult.error || 'Backend device validation failed.',
          } satisfies LlamaCppInstallProgress);
          return {
            ...result,
            success: false,
            error: deviceResult.error || 'Backend device validation failed.',
          };
        }
        const validationError = validateBackendDevices(ref, deviceResult.devices);
        if (validationError) {
          this.setStatus({
            status: 'not-installed',
            executablePath: undefined,
            managedByApp: false,
            error: validationError,
          });
          this.emit('install-progress', {
            phase: 'failed',
            modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
            modelName: ref.versionBackend,
            error: validationError,
          } satisfies LlamaCppInstallProgress);
          return {
            ...result,
            success: false,
            error: validationError,
          };
        }
      }
      syncCurrentBackend(runtimeRoot, ref);
      const currentExecutablePath = getLlamaCppCurrentExecutablePath(runtimeRoot, process.platform);
      this.executablePath = currentExecutablePath;
      this.setStatus({
        status: 'installed',
        executablePath: currentExecutablePath,
        managedByApp: false,
      });
      this.emit('install-progress', {
        phase: 'done',
        modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
        modelName: ref.versionBackend,
        percent: 100,
      } satisfies LlamaCppInstallProgress);
    } else {
      this.setStatus({
        status: 'not-installed',
        executablePath: undefined,
        managedByApp: false,
        error: result.error,
      });
      this.emit('install-progress', {
        phase: result.cancelled ? 'cancelled' : 'failed',
        modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
        modelName: ref.versionBackend,
        error: result.cancelled ? undefined : 'error' in result ? result.error : undefined,
      } satisfies LlamaCppInstallProgress);
    }
    return installWarning && result.success ? { ...result, warning: installWarning } : result;
  }

  protected async installBundledRuntime(
    options: { signal?: AbortSignal } = {},
  ): Promise<LlamaCppRuntimeInstallResult> {
    void options;
    const runtimeRoot = getUserLlamaCppRuntimeRoot();
    const nvidiaSnapshot = await getLlamaCppNvidiaSnapshot();
    const manifest = readBundledLlamaCppRuntimeManifest();
    if (!manifest) {
      const error = 'Bundled llama.cpp runtime manifest is missing from this installation.';
      this.setStatus({ status: 'not-installed', managedByApp: true, error });
      return { success: false, plan: { kind: 'needs-manual', message: error }, error };
    }

    let preferCpuFallback = false;
    let installWarning: string | undefined;
    if (shouldEnforceCudaEditionGpuPolicy() && !primaryGpuSupportsCudaEdition(nvidiaSnapshot)) {
      installWarning = resolveCudaEditionGpuMessage(nvidiaSnapshot);
      preferCpuFallback = Boolean(manifest.cpuFallbackExecutable);
      if (!preferCpuFallback) {
        this.setStatus({ status: 'not-installed', managedByApp: true, error: installWarning });
        return {
          success: false,
          plan: { kind: 'needs-manual', message: installWarning },
          error: installWarning,
        };
      }
    }

    let resolved: ResolvedBundledRuntime;
    try {
      resolved = await resolveBundledEditionRuntime({ manifest, preferCpuFallback });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ status: 'not-installed', managedByApp: true, error: message });
      return { success: false, plan: { kind: 'needs-manual', message }, error: message };
    }

    this.bundledRuntimeSelection = resolved;
    this.bundledStartupCpuFallbackAttempted = false;
    syncCurrentBackend(runtimeRoot, resolved.backend);
    this.executablePath = resolved.executablePath;
    this.setStatus({
      status: 'installed',
      executablePath: resolved.executablePath,
      managedByApp: true,
    });
    this.emit('install-progress', {
      phase: 'done',
      modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
      modelName: resolved.backend.versionBackend,
      percent: 100,
    } satisfies LlamaCppInstallProgress);
    return {
      success: true,
      plan: { kind: 'ready', executablePath: resolved.executablePath },
      executablePath: resolved.executablePath,
      ...(installWarning ? { warning: installWarning } : {}),
    };
  }

  async listRuntimeDevices(ref?: LlamaCppBackendRef): Promise<LlamaCppRuntimeListDevicesResult> {
    let executablePath = this.executablePath;
    if (ref) {
      executablePath = getLlamaCppBackendExecutablePath(
        getUserLlamaCppRuntimeRoot(),
        ref,
        process.platform,
      );
    }
    if (!executablePath) {
      this.executablePath = await findLlamaCppExecutable(this.getServiceConfig());
      executablePath = this.executablePath;
    }
    if (!executablePath) {
      return {
        success: false,
        devices: [],
        error: 'llama.cpp runtime is not installed.',
      };
    }
    if (!fs.existsSync(executablePath)) {
      return {
        success: false,
        executablePath,
        backend: ref,
        devices: [],
        error: `llama.cpp executable does not exist: ${executablePath}`,
      };
    }
    const result = await listLlamaCppRuntimeDevices({
      executablePath,
      platform: process.platform,
      baseEnv: process.env,
    });
    return ref ? { ...result, backend: ref } : result;
  }

  async getRuntimeCapabilities(): Promise<LlamaCppRuntimeCapabilities> {
    if (!this.executablePath) {
      this.executablePath = await findLlamaCppExecutable(this.getServiceConfig());
    }
    if (!this.executablePath) {
      return {
        success: false,
        flags: [],
        deviceProbeSucceeded: false,
        devices: [],
        backendKinds: [],
        gpuDeviceCount: 0,
        supports: {},
        error: 'llama.cpp runtime is not installed.',
      };
    }

    const [helpFlagsResult, devicesResult] = await Promise.all([
      listLlamaCppRuntimeHelpFlags({
        executablePath: this.executablePath,
        platform: process.platform,
        baseEnv: process.env,
      }),
      this.listRuntimeDevices(),
    ]);

    const devices = devicesResult.success ? devicesResult.devices : [];
    const backendKinds = Array.from(new Set(devices.map(device => device.backend).filter(Boolean)));
    const gpuDeviceCount = devices.filter(device => isGpuLikeRuntimeDevice(device)).length;
    return {
      success: helpFlagsResult.success || devicesResult.success,
      executablePath: this.executablePath,
      version: this.status.version,
      runtimeTargetId: devicesResult.runtimeTargetId,
      flags: helpFlagsResult.flags,
      deviceProbeSucceeded: devicesResult.success,
      devices,
      backendKinds,
      gpuDeviceCount,
      supports: buildLlamaCppServiceConfigFieldSupport({
        helpProbeSucceeded: helpFlagsResult.success,
        flags: helpFlagsResult.flags,
        devices,
        runtimeBackend: this.status.runtimeBackend,
      }),
      ...(helpFlagsResult.success
        ? {}
        : { error: helpFlagsResult.error ?? devicesResult.error ?? 'Failed to probe runtime.' }),
    };
  }

  /**
   * Import a user-provided llama.cpp runtime from a local directory.
   * Copies all files from the directory containing llama-server into
   * <runtimeRoot>/current/bin/, matching the existing auto-download
   * copy strategy. Platform differences (DLLs, dylibs, .so) are handled
   * automatically by copying the full directory.
   */

  protected async isHealthy(): Promise<boolean> {
    try {
      const version = await new LlamaCppClient(this.getBaseUrl()).version(300);
      this.setStatus({
        status: 'running',
        version: version.version,
        executablePath: this.executablePath ?? undefined,
        pid: this.process?.pid,
        managedByApp: Boolean(this.process),
      });
      return true;
    } catch {
      return false;
    }
  }

  protected async waitForStartupProcessExit(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const settle = () => {
        child.off('exit', settle);
        child.off('error', settle);
        resolve();
      };
      child.once('exit', settle);
      child.once('error', settle);
    });
  }

  protected formatStartupExitDetail(code: number | null, signal: NodeJS.Signals | null): string {
    const exitCode = code === null ? 'null' : `${code} (0x${code.toString(16)})`;
    return `exit code ${exitCode}, signal ${signal ?? 'null'}`;
  }

  protected async waitUntilHealthy(timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.isHealthy()) return;
      if (this.status.status === 'error' || this.status.status === 'stopped') {
        return; // exit handler already set an error
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const detail = this.startupStderr ? ` (stderr: ${this.startupStderr.slice(0, 300)})` : '';
    this.setStatus({
      status: 'error',
      executablePath: this.executablePath ?? undefined,
      error: `llama.cpp did not become ready before timeout${detail}`,
      managedByApp: Boolean(this.process),
    });
  }

  protected setStatus(
    patch: Omit<Partial<LlamaCppStatusSnapshot>, 'checkedAt'> & {
      status: LlamaCppStatusSnapshot['status'];
    },
  ): void {
    const executablePath = Object.prototype.hasOwnProperty.call(patch, 'executablePath')
      ? patch.executablePath
      : this.status.executablePath;
    this.status = {
      ...this.status,
      ...patch,
      ...resolveLlamaCppRuntimeMetadata(executablePath),
      checkedAt: new Date().toISOString(),
    };
    this.emit('status', this.status);
  }
}
