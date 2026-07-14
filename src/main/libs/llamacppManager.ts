import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { app } from 'electron';
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
  syncCurrentBackend,
  uninstallLlamaCppBackend,
} from './llamacppBackendManager';
import {
  backendRequiresDeviceValidation,
  validateBackendDevices,
} from './llamacppBackendValidation';
import { LlamaCppClient } from './llamacppClient';
import {
  isPathInside,
  mergeLocalModels,
  scanLocalGgufModels,
} from './llamacppModelCatalog';
import {
  installModelOnce,
  isModelDownloadNotFoundError,
  isSameInstallRequest,
  prefillInstallInputFromMarketplace,
  refreshInstallInputFromMarketplace,
  resolveManagedModelInstallDir,
} from './llamacppModelInstallation';
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
  listLlamaCppRuntimeDevices,
  listLlamaCppRuntimeHelpFlags,
  resolveLlamaCppDeviceSelection,
  shouldEnableLlamaCppModelsAutoload,
} from './llamacppServe';
import { MarketplaceService } from './marketplaceService';
import { getNvidiaSmiSnapshot } from './nvidiaSmi';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = '8080';
const DEFAULT_CONNECTION_AND_LOAD_TIMEOUT_MS = 120_000;
const QUIT_RUNNING_MODELS_TIMEOUT_MS = 1500;
const QUIT_UNLOAD_MODEL_TIMEOUT_MS = 3000;
const LLAMACPP_RUNTIME_PROGRESS_KEY = '__llamacpp_runtime__';
const LLAMACPP_LAST_LOADED_MODEL_KEY = 'llamacpp_last_loaded_model';

type RequestOptions = { signal?: AbortSignal };

type LlamaCppManagerStorage = {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
};

export class LlamaCppManager extends EventEmitter {
  private executablePath: string | null = null;
  private process: ChildProcessWithoutNullStreams | null = null;
  private runtimeContextLengthByModel = new Map<string, number>();
  private thinkingToggleSupportByModel = new Map<string, boolean>();
  private startupStderr = '';
  private readonly marketplaceService: MarketplaceService;
  private readonly storage?: LlamaCppManagerStorage;
  private status: LlamaCppStatusSnapshot = {
    status: 'unknown',
    checkedAt: new Date().toISOString(),
  };

  constructor(
    private readonly getServiceConfig: () => LlamaCppServiceConfig = () => ({}),
    marketplaceService?: MarketplaceService,
    storage?: LlamaCppManagerStorage,
  ) {
    super();
    this.marketplaceService = marketplaceService ?? new MarketplaceService(() => this.getModelsDir());
    this.storage = storage;
  }

  getStatus(): LlamaCppStatusSnapshot {
    return this.status;
  }

  getBaseUrl(): string {
    const config = this.getServiceConfig();
    const host = config.host?.trim() === '0.0.0.0'
      ? DEFAULT_HOST
      : config.host?.trim() || DEFAULT_HOST;
    const port = config.port?.trim() || DEFAULT_PORT;
    return `http://${host}:${port}`;
  }

  getModelsDir(): string {
    return (
      this.getServiceConfig().modelsDir?.trim() ||
      path.join(app.getPath('userData'), 'models', 'llamacpp')
    );
  }

  getPresetPath(): string {
    return path.join(app.getPath('userData'), 'llamacpp', 'models-preset.ini');
  }

  getConnectionAndLoadTimeoutMs(): number {
    const configuredSeconds = normalizePositiveInteger(this.getServiceConfig().timeout);
    if (!configuredSeconds) return DEFAULT_CONNECTION_AND_LOAD_TIMEOUT_MS;
    return configuredSeconds * 1000;
  }

  private async resolveRuntimeServiceConfig(): Promise<LlamaCppServiceConfig> {
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
    const nvidiaSnapshot = process.platform === 'win32' ? await getNvidiaSmiSnapshot() : null;
    const resolvedRuntimeConfig = applyAutomaticLlamaCppServiceDefaults(runtimeConfig, {
      nvidiaSnapshot,
    });
    const runtimeCapabilities = await this.getRuntimeCapabilities().catch((): null => null);
    const filteredRuntimeConfig = filterLlamaCppServiceConfigByRuntimeCapabilities(
      resolvedRuntimeConfig,
      runtimeCapabilities,
    );
    this.setStatus({ status: 'starting', executablePath: this.executablePath, managedByApp: true });
    this.process = spawn(
      this.executablePath,
      buildLlamaServerArgs(filteredRuntimeConfig, this.getModelsDir(), this.getPresetPath()),
      {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildLlamaCppServeEnv(process.env, this.executablePath, process.platform),
      },
    );

    this.startupStderr = '';
    this.process.stdout.on('data', chunk => console.debug(`[LlamaCpp] ${chunk.toString().trim()}`));
    this.process.stderr.on('data', chunk => {
      const text = chunk.toString().trim();
      console.warn(`[LlamaCpp] ${text}`);
      this.startupStderr += (this.startupStderr ? '\n' : '') + text;
    });
    this.process.on('exit', (code, signal) => {
      console.log(
        `[LlamaCpp] process exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`,
      );
      this.process = null;
      if (this.status.status === 'starting') {
        const stderrSnippet = this.startupStderr
          ? `: ${this.startupStderr.slice(0, 300)}`
          : ` (exit code ${code ?? 'null'})`;
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
    this.process.on('error', error => {
      console.warn('[LlamaCpp] process failed:', error);
      this.setStatus({
        status: 'error',
        error: error.message,
        executablePath: this.executablePath ?? undefined,
        managedByApp: false,
      });
    });

    await this.waitUntilHealthy(this.getConnectionAndLoadTimeoutMs());
    return this.status;
  }

  async installRuntime(): Promise<LlamaCppRuntimeInstallResult> {
    this.emit('install-progress', {
      phase: 'starting',
      modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
      modelName: 'llama.cpp runtime',
    } satisfies LlamaCppInstallProgress);
    const config = this.getServiceConfig();
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
    const nvidiaSnapshot = process.platform === 'win32' ? await getNvidiaSmiSnapshot() : null;
    const manifest = await fetchLlamaCppBackendManifest();
    const ref = recommendLlamaCppBackend({
      manifest,
      platform: process.platform,
      arch: process.arch,
      hasNvidiaGpu: Boolean(nvidiaSnapshot?.available && nvidiaSnapshot.gpus.length > 0),
      config,
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

    const result = await installLlamaCppBackend({
      runtimeRoot,
      ref,
      platform: process.platform,
      arch: process.arch,
      hasNvidiaGpu: Boolean(nvidiaSnapshot?.available && nvidiaSnapshot.gpus.length > 0),
      manifest,
      switchCurrent: false,
      onProgress: progress => {
        this.emit('install-progress', {
          modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
          modelName: ref.versionBackend,
          ...progress,
        } satisfies LlamaCppInstallProgress);
      },
    });

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
        phase: 'failed',
        modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
        modelName: ref.versionBackend,
        error: 'error' in result ? result.error : undefined,
      } satisfies LlamaCppInstallProgress);
    }
    return result;
  }

  async listBackends(): Promise<LlamaCppBackendListResult> {
    try {
      const nvidiaSnapshot = process.platform === 'win32' ? await getNvidiaSmiSnapshot() : null;
      const result = await listLlamaCppBackends({
        runtimeRoot: getUserLlamaCppRuntimeRoot(),
        platform: process.platform,
        arch: process.arch,
        hasNvidiaGpu: Boolean(nvidiaSnapshot?.available && nvidiaSnapshot.gpus.length > 0),
        config: this.getServiceConfig(),
      });
      return { success: true, ...result };
    } catch (error) {
      return {
        success: false,
        backends: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getBackendSelection(): Promise<LlamaCppBackendRef | undefined> {
    return readCurrentBackendRef(getUserLlamaCppRuntimeRoot());
  }

  async setBackendSelection(ref: LlamaCppBackendRef): Promise<LlamaCppRuntimeInstallResult> {
    const runtimeRoot = getUserLlamaCppRuntimeRoot();
    const installedExecutablePath = getLlamaCppBackendExecutablePath(runtimeRoot, ref, process.platform);
    const nvidiaSnapshot = process.platform === 'win32' ? await getNvidiaSmiSnapshot() : null;
    const hasNvidiaGpu = Boolean(nvidiaSnapshot?.available && nvidiaSnapshot.gpus.length > 0);
    this.emit('install-progress', {
      phase: 'starting',
      modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
      modelName: ref.versionBackend,
    } satisfies LlamaCppInstallProgress);
    const compatibilityError = await getLlamaCppBackendCompatibilityError({
      runtimeRoot,
      ref,
      platform: process.platform,
      arch: process.arch,
      hasNvidiaGpu,
    });
    if (compatibilityError) {
      this.emit('install-progress', {
        phase: 'failed',
        modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
        modelName: ref.versionBackend,
        error: compatibilityError,
      } satisfies LlamaCppInstallProgress);
      return {
        success: false,
        error: compatibilityError,
        plan: {
          kind: 'needs-manual',
          message: compatibilityError,
        },
      };
    }
    const result = fs.existsSync(installedExecutablePath)
      ? (() => {
          return {
            success: true,
            backend: ref,
            executablePath: installedExecutablePath,
            plan: {
              kind: 'ready' as const,
              executablePath: installedExecutablePath,
            },
          };
        })()
      : await (async () => {
          this.emit('install-progress', {
            phase: 'downloading',
            modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
            modelName: ref.versionBackend,
          } satisfies LlamaCppInstallProgress);
          return await installLlamaCppBackend({
            runtimeRoot,
            ref,
            platform: process.platform,
            arch: process.arch,
            hasNvidiaGpu,
            switchCurrent: false,
            onProgress: progress => {
              this.emit('install-progress', {
                modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
                modelName: ref.versionBackend,
                ...progress,
              } satisfies LlamaCppInstallProgress);
            },
          });
        })();
    if (result.success && result.executablePath) {
      if (backendRequiresDeviceValidation(ref)) {
        const deviceResult = await this.listRuntimeDevices(ref);
        if (!deviceResult.success) {
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
      this.emit('install-progress', {
        phase: 'failed',
        modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
        modelName: ref.versionBackend,
        error: 'error' in result ? result.error : undefined,
      } satisfies LlamaCppInstallProgress);
    }
    return result;
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
  async importRuntime(sourceDir: string): Promise<LlamaCppRuntimeImportResult> {
    const executableName = resolveLlamaCppExecutableName(process.platform);
    const sourceExecutable = path.join(sourceDir, executableName);

    if (!fs.existsSync(sourceExecutable)) {
      return {
        success: false,
        error: `未在所选目录中找到 ${executableName}。请选择包含 ${executableName} 的目录。`,
      };
    }

    // Verify the executable is actually runnable
    try {
      await this.stop();
      const nvidiaSnapshot = process.platform === 'win32' ? await getNvidiaSmiSnapshot() : null;
      const result = await importLlamaCppBackendPath({
        runtimeRoot: getUserLlamaCppRuntimeRoot(),
        sourcePath: sourceDir,
        platform: process.platform,
        arch: process.arch,
        hasNvidiaGpu: Boolean(nvidiaSnapshot?.available && nvidiaSnapshot.gpus.length > 0),
      });
      if (!result.success || !result.executablePath) return result;
      this.executablePath = result.executablePath;
      this.setStatus({
        status: 'installed',
        executablePath: result.executablePath,
        managedByApp: false,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({
        status: 'not-installed',
        executablePath: this.executablePath ?? undefined,
        managedByApp: false,
        error: message,
      });
      return { success: false, error: message };
    }
  }

  async uninstallRuntime(): Promise<LlamaCppRuntimeUninstallResult> {
    const runtimeRoot = getUserLlamaCppRuntimeRoot();
    try {
      const result = await uninstallLlamaCppBackend({
        runtimeRoot,
        status: this.status,
        stopCurrent: async () => {
          if (this.process && this.executablePath && isPathInside(this.executablePath, runtimeRoot)) {
            await this.stop();
          }
        },
      });
      if (this.executablePath && isPathInside(this.executablePath, runtimeRoot)) {
        this.executablePath = null;
      }
      const status = await this.detect();
      return { ...result, status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({
        status: 'error',
        executablePath: this.executablePath ?? undefined,
        managedByApp: Boolean(this.process),
        error: message,
      });
      return { success: false, deleted: false, runtimeRoot, status: this.status, error: message };
    }
  }

  async uninstallBackend(ref: LlamaCppBackendRef): Promise<LlamaCppRuntimeUninstallResult> {
    const runtimeRoot = getUserLlamaCppRuntimeRoot();
    try {
      const result = await uninstallLlamaCppBackend({
        runtimeRoot,
        ref,
        status: this.status,
        stopCurrent: async () => {
          if (this.process && this.executablePath && isPathInside(this.executablePath, runtimeRoot)) {
            await this.stop();
          }
        },
      });
      if (this.executablePath && isPathInside(this.executablePath, runtimeRoot)) {
        this.executablePath = null;
      }
      const status = await this.detect();
      return { ...result, status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({
        status: 'error',
        executablePath: this.executablePath ?? undefined,
        managedByApp: Boolean(this.process),
        error: message,
      });
      return { success: false, deleted: false, runtimeRoot, backend: ref, status: this.status, error: message };
    }
  }

  async stop(): Promise<LlamaCppStatusSnapshot> {
    if (!this.process) {
      if (await this.isHealthy()) {
        this.setStatus({
          status: 'running',
          executablePath: this.executablePath ?? undefined,
          managedByApp: false,
          error: 'llama.cpp is running outside this app and must be stopped externally.',
        });
        return this.status;
      }

      this.setStatus({
        status: 'stopped',
        executablePath: this.executablePath ?? undefined,
        managedByApp: false,
      });
      return this.status;
    }

    const child = this.process;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill('SIGTERM');
    });
    this.process = null;
    if (await this.isHealthy()) {
      this.setStatus({
        status: 'running',
        executablePath: this.executablePath ?? undefined,
        managedByApp: false,
        error: 'llama.cpp is still running outside this app.',
      });
      return this.status;
    }

    this.setStatus({
      status: 'stopped',
      executablePath: this.executablePath ?? undefined,
      managedByApp: false,
    });
    return this.status;
  }

  async restart(): Promise<LlamaCppStatusSnapshot> {
    await this.stop();
    return await this.start();
  }

  async client(): Promise<LlamaCppClient> {
    if (this.status.status !== 'running') {
      await this.detect();
    }
    return new LlamaCppClient(this.getBaseUrl(), {
      loadTimeoutMs: this.getConnectionAndLoadTimeoutMs(),
    });
  }

  private async restoreLastLoadedModelIfNeeded(): Promise<void> {
    const config = this.getServiceConfig();
    if (!config.modelsAutoload || !shouldEnableLlamaCppModelsAutoload(config.modelsMax)) {
      return;
    }
    const modelName = this.getLastLoadedModel();
    if (!modelName) return;
    let runningModels: LlamaCppRunningModel[] = [];
    try {
      runningModels = await this.listRunningModels();
    } catch (error) {
      console.warn('[LlamaCpp] failed to inspect running models before startup restore:', error);
    }
    if (runningModels.some(model => model.name === modelName || model.model === modelName || model.id === modelName)) {
      return;
    }
    try {
      console.log(`[LlamaCpp] restoring last loaded model on startup: ${modelName}`);
      await this.loadModel({ model: modelName });
    } catch (error) {
      console.warn(`[LlamaCpp] failed to restore last loaded model on startup: ${modelName}`, error);
    }
  }

  private getLastLoadedModel(): string | undefined {
    if (!this.storage) return undefined;
    const value = this.storage.get<unknown>(LLAMACPP_LAST_LOADED_MODEL_KEY);
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private persistLastLoadedModel(modelName: string): void {
    this.storage?.set(LLAMACPP_LAST_LOADED_MODEL_KEY, modelName.trim());
  }

  private clearLastLoadedModel(modelName?: string): void {
    if (!this.storage) return;
    if (!modelName) {
      this.storage.delete(LLAMACPP_LAST_LOADED_MODEL_KEY);
      return;
    }
    if (this.getLastLoadedModel() === modelName.trim()) {
      this.storage.delete(LLAMACPP_LAST_LOADED_MODEL_KEY);
    }
  }

  async loadModel(input: LlamaCppModelLaunchInput): Promise<LlamaCppModelLaunchResult> {
    const localModels = await this.listLocalModels().catch(() => [] as LlamaCppModel[]);
    const resolvedInput = await this.resolveModelLoadInput(input, localModels);
    const modelName = resolvedInput.model.trim();
    if (!modelName) throw new Error('Model name is required');
    await this.writeModelPreset(resolvedInput, localModels);
    const client = await this.client();
    await client.listModels();
    const result = await client.loadModel(resolvedInput);
    this.persistLastLoadedModel(modelName);
    const resolvedRuntimeContextLength = resolvedInput.options?.ctxSize;
    if (resolvedRuntimeContextLength) {
      this.runtimeContextLengthByModel.set(modelName, resolvedRuntimeContextLength);
    }
    return {
      ...result,
      runningModels: this.hydrateRunningModels(result.runningModels),
    };
  }

  async listRunningModels(timeoutMs = 30_000): Promise<LlamaCppRunningModel[]> {
    const runningModels = await (await this.client()).runningModels(timeoutMs);
    if (this.needsThinkingToggleSupportRefresh(runningModels)) {
      this.refreshThinkingToggleSupport();
    }
    return this.hydrateRunningModels(runningModels);
  }

  getRuntimeContextLength(modelName: string): number | undefined {
    return this.runtimeContextLengthByModel.get(modelName.trim());
  }

  async listLocalModels(): Promise<LlamaCppModel[]> {
    const scannedModels = scanLocalGgufModels(this.getModelsDir());
    this.cacheThinkingToggleSupport(scannedModels);
    let routerModels: LlamaCppModel[] = [];
    try {
      routerModels = await (await this.client()).listModels();
    } catch (error) {
      console.warn('[LlamaCpp] failed to list router models, using local GGUF scan:', error);
    }
    const scannedPathSet = new Set(
      scannedModels
        .map(model => model.path?.trim())
        .filter((value): value is string => Boolean(value))
        .map(modelPath => path.resolve(modelPath)),
    );
    return mergeLocalModels(routerModels, scannedModels).filter(model => {
      const modelPath = model.path?.trim();
      return Boolean(modelPath && scannedPathSet.has(path.resolve(modelPath)));
    });
  }

  async deleteModel(
    name: string,
  ): Promise<{
    success: boolean;
    deleted?: boolean;
    reason?: 'not-local-file' | 'not-app-managed';
    error?: string;
    removedModelName?: string;
  }> {
    const modelName = name.trim();
    if (!modelName) throw new Error('Model name is required');
    const models = await this.listLocalModels();
    const model = models.find(item => item.name === modelName || item.id === modelName);
    const modelPath = model?.path;
    if (!modelPath || !isGgufPath(modelPath)) {
      return {
        success: false,
        deleted: false,
        reason: 'not-local-file',
        error: 'Only local GGUF model files can be deleted.',
      };
    }
    const root = path.resolve(this.getModelsDir());
    const target = path.resolve(modelPath);
    if (!target.startsWith(root + path.sep) && target !== root) {
      return {
        success: false,
        deleted: false,
        reason: 'not-app-managed',
        error: 'Only models in the app-managed models directory can be deleted.',
      };
    }
    await (await this.client()).unloadModel(modelName).catch((): undefined => undefined);
    fs.rmSync(target, { force: true, recursive: true });
    removeEmptyParentDirs(path.dirname(target), root);
    this.runtimeContextLengthByModel.delete(modelName);
    this.clearLastLoadedModel(modelName);
    return { success: true, deleted: true, removedModelName: modelName };
  }

  async installModel(
    input: LlamaCppInstallModelInput,
    onProgress?: (progress: LlamaCppInstallProgress) => void,
    options: RequestOptions = {},
  ): Promise<LlamaCppModel> {
    const modelId = input.modelId.trim();
    if (!modelId) throw new Error('Model ID is required');
    onProgress?.({ phase: 'starting', modelId, modelName: input.displayName ?? modelId });
    const safeModelDir = resolveManagedModelInstallDir(this.getModelsDir(), modelId);
    fs.mkdirSync(safeModelDir, { recursive: true });
    let request = await prefillInstallInputFromMarketplace(input, this.marketplaceService);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await installModelOnce({
          request,
          safeModelDir,
          modelsDir: this.getModelsDir(),
          onProgress,
          options,
          refreshModelsAfterInstall: () => this.refreshModelsAfterInstall(),
        });
      } catch (error) {
        lastError = error;
        if (attempt > 0 || !isModelDownloadNotFoundError(error)) {
          throw error;
        }
        const refreshed = await refreshInstallInputFromMarketplace(request, this.marketplaceService);
        if (!refreshed || isSameInstallRequest(request, refreshed)) {
          throw error;
        }
        request = refreshed;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async importModelFiles(filePaths: string[]): Promise<LlamaCppModel[]> {
    const modelsDir = this.getModelsDir();
    const importDir = path.join(modelsDir, 'imported');
    fs.mkdirSync(importDir, { recursive: true });

    const importedPaths: string[] = [];
    for (const filePath of filePaths) {
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.toLowerCase().endsWith('.gguf')) {
        continue;
      }

      const targetPath = resolveImportedModelTargetPath(importDir, resolvedPath);
      fs.copyFileSync(resolvedPath, targetPath);
      importedPaths.push(targetPath);
    }

    await this.refreshModelsAfterInstall();

    if (importedPaths.length === 0) {
      return [];
    }

    const importedPathSet = new Set(importedPaths.map(targetPath => path.resolve(targetPath)));
    return scanLocalGgufModels(modelsDir).filter(model =>
      Boolean(model.path && importedPathSet.has(path.resolve(model.path))),
    );
  }

  async shutdownForQuit(): Promise<LlamaCppStatusSnapshot> {
    await this.unloadAllRunningModels();
    return await this.stop();
  }

  async unloadAllRunningModels(): Promise<void> {
    const client = new LlamaCppClient(this.getBaseUrl());
    let runningModels: LlamaCppRunningModel[];
    try {
      runningModels = await this.listRunningModels(QUIT_RUNNING_MODELS_TIMEOUT_MS);
    } catch (error) {
      console.debug(
        '[LlamaCpp] skipped model unload during quit because running models could not be listed:',
        error,
      );
      return;
    }

    const modelNames = Array.from(
      new Set(runningModels.map(model => (model.name || model.model || '').trim()).filter(Boolean)),
    );
    if (modelNames.length === 0) return;

    console.log(`[LlamaCpp] unloading ${modelNames.length} model(s) during app quit`);
    const results = await Promise.allSettled(
      modelNames.map(async modelName => {
        await client.unloadModel(modelName, QUIT_UNLOAD_MODEL_TIMEOUT_MS);
      }),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(
          `[LlamaCpp] failed to unload model ${modelNames[index]} during quit:`,
          result.reason,
        );
      }
    });
  }

  private async writeModelPreset(
    input: LlamaCppModelLaunchInput,
    models: LlamaCppModel[],
  ): Promise<void> {
    const model = models.find(item => item.name === input.model || item.id === input.model);
    const modelPath = input.modelPath || model?.path;
    const existing = fs.existsSync(this.getPresetPath())
      ? fs.readFileSync(this.getPresetPath(), 'utf-8')
      : 'version = 1\n\n';
    const next = upsertIniSection(existing, input.model, {
      ...(modelPath ? { model: modelPath } : {}),
      ...modelLaunchOptionsToPreset(input.options ?? {}),
    });
    fs.mkdirSync(path.dirname(this.getPresetPath()), { recursive: true });
    fs.writeFileSync(this.getPresetPath(), next, 'utf-8');
  }

  private async resolveModelLoadInput(
    input: LlamaCppModelLaunchInput,
    models: LlamaCppModel[],
  ): Promise<LlamaCppModelLaunchInput> {
    const modelName = input.model.trim();
    if (!modelName) throw new Error('Model name is required');

    const explicitContextSize = input.options?.ctxSize;
    const requestedContextSize =
      typeof explicitContextSize === 'number' && explicitContextSize > 0
        ? explicitContextSize
        : await this.resolveDefaultModelContextSize();
    if (!requestedContextSize) {
      return {
        ...input,
        model: modelName,
      };
    }

    const targetModel = models.find(
      model => model.name === modelName || model.id === modelName || model.model === modelName,
    );
    const contextResolution = resolveLlamaCppLaunchContext({
      requestedContextLength: requestedContextSize,
      trainedContextLength:
        targetModel?.trained_context_length ?? targetModel?.details?.context_length,
    });
    if (contextResolution.clamped) {
      console.warn(
        `[LlamaCpp] clamped requested context ${contextResolution.requestedContextLength} to training limit ${contextResolution.trainedContextLength} for ${modelName}`,
      );
    }

    const resolvedContextSize = contextResolution.effectiveContextLength;
    if (!resolvedContextSize) {
      return {
        ...input,
        model: modelName,
      };
    }

    return {
      ...input,
      model: modelName,
      options: {
        ...input.options,
        ctxSize: resolvedContextSize,
      },
    };
  }

  private async resolveDefaultModelContextSize(): Promise<number | undefined> {
    const configuredContextSize = normalizePositiveInteger(this.getServiceConfig().ctxSize);
    if (configuredContextSize) {
      return configuredContextSize;
    }

    const nvidiaSnapshot = process.platform === 'win32'
      ? await getNvidiaSmiSnapshot().catch((): null => null)
      : null;
    const runtimeConfig = applyAutomaticLlamaCppServiceDefaults(this.getServiceConfig(), {
      nvidiaSnapshot,
    });
    return normalizePositiveInteger(runtimeConfig.ctxSize);
  }

  private async isHealthy(): Promise<boolean> {
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

  private async waitUntilHealthy(timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.isHealthy()) return;
      if (this.status.status === 'error' || this.status.status === 'stopped') {
        return; // exit handler already set an error
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const detail = this.startupStderr
      ? ` (stderr: ${this.startupStderr.slice(0, 300)})`
      : '';
    this.setStatus({
      status: 'error',
      executablePath: this.executablePath ?? undefined,
      error: `llama.cpp did not become ready before timeout${detail}`,
      managedByApp: Boolean(this.process),
    });
  }

  private setStatus(
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

  private async refreshModelsAfterInstall(): Promise<void> {
    try {
      await new LlamaCppClient(this.getBaseUrl()).listModels();
    } catch {
      // The model list will be refreshed when the service is started.
    }
  }

  private hydrateRunningModels(runningModels: LlamaCppRunningModel[]): LlamaCppRunningModel[] {
    const visibleModelNames = new Set<string>();
    const hydrated = runningModels.map(model => {
      const modelName = (model.name || model.model || model.id || '').trim();
      if (modelName) {
        visibleModelNames.add(modelName);
      }
      const runtimeContextLength =
        model.runtime_context_length ??
        (modelName ? this.runtimeContextLengthByModel.get(modelName) : undefined);
      if (modelName && runtimeContextLength) {
        this.runtimeContextLengthByModel.set(modelName, runtimeContextLength);
      }
      const trainedContextLength =
        model.trained_context_length ?? model.details?.context_length ?? model.context_length;
      const supportsThinkingToggle =
        model.supportsThinkingToggle ?? this.getThinkingToggleSupport(model);
      return {
        ...model,
        context_length: trainedContextLength,
        trained_context_length: trainedContextLength,
        runtime_context_length: runtimeContextLength,
        effective_options: runtimeContextLength
          ? { ctxSize: runtimeContextLength }
          : model.effective_options,
        ...(supportsThinkingToggle !== undefined ? { supportsThinkingToggle } : {}),
      };
    });

    for (const cachedModelName of Array.from(this.runtimeContextLengthByModel.keys())) {
      if (!visibleModelNames.has(cachedModelName)) {
        this.runtimeContextLengthByModel.delete(cachedModelName);
      }
    }

    return hydrated;
  }

  private cacheThinkingToggleSupport(models: LlamaCppModel[]): void {
    this.thinkingToggleSupportByModel.clear();
    models.forEach(model => {
      if (model.supportsThinkingToggle === undefined) return;
      this.getModelReferenceKeys(model).forEach(key => {
        this.thinkingToggleSupportByModel.set(key, model.supportsThinkingToggle === true);
      });
    });
  }

  private refreshThinkingToggleSupport(): void {
    this.cacheThinkingToggleSupport(scanLocalGgufModels(this.getModelsDir()));
  }

  private needsThinkingToggleSupportRefresh(runningModels: LlamaCppRunningModel[]): boolean {
    return runningModels.some(model =>
      model.supportsThinkingToggle === undefined
      && this.getThinkingToggleSupport(model) === undefined,
    );
  }

  private getThinkingToggleSupport(model: LlamaCppModel): boolean | undefined {
    return this.getModelReferenceKeys(model)
      .map(key => this.thinkingToggleSupportByModel.get(key))
      .find((supported): supported is boolean => supported !== undefined);
  }

  private getModelReferenceKeys(model: LlamaCppModel): string[] {
    return [model.name, model.id, model.model, model.path]
      .filter((value): value is string => Boolean(value?.trim()))
      .map(value => value.trim().replace(/\\/g, '/'))
      .flatMap(value => [value, path.basename(value)])
      .map(value => value.toLowerCase());
  }
}

function normalizePositiveInteger(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveImportedModelTargetPath(importDir: string, sourcePath: string): string {
  const extension = path.extname(sourcePath) || '.gguf';
  const baseName = path.basename(sourcePath, extension);
  let attempt = 0;

  while (true) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const candidate = path.join(importDir, `${baseName}${suffix}${extension}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    attempt += 1;
  }
}
export {
  isPathInside,
  mergeLocalModels,
  scanLocalGgufModels,
} from './llamacppModelCatalog';
export {
  chooseModelScopeInstallFile,
  extractModelScopeFilePaths,
} from './llamacppModelInstallation';
export {
  buildLlamaCppExecutableCandidates,
  findLlamaCppExecutable,
  resolveLlamaCppRuntimeTargetPreference,
  selectLlamaCppRuntimeTarget,
} from './llamacppRuntimePaths';
export {
  buildLlamaCppServeEnv,
  buildLlamaServerArgs,
  filterLlamaCppServiceConfigByRuntimeCapabilities,
  listLlamaCppRuntimeDevices,
  listLlamaCppRuntimeHelpFlags,
  parseLlamaCppHelpFlags,
  parseLlamaCppListDevicesOutput,
  resolveLlamaCppDeviceSelection,
  shouldEnableLlamaCppModelsAutoload,
} from './llamacppServe';

export function modelLaunchOptionsToPreset(
  options: NonNullable<LlamaCppModelLaunchInput['options']>,
): Record<string, string | number | boolean> {
  return {
    ...(options.ctxSize !== undefined ? { 'ctx-size': options.ctxSize } : {}),
    ...(options.batchSize !== undefined ? { 'batch-size': options.batchSize } : {}),
    ...(options.ubatchSize !== undefined ? { 'ubatch-size': options.ubatchSize } : {}),
    ...(options.gpuLayers !== undefined ? { 'n-gpu-layers': options.gpuLayers } : {}),
    ...(options.threads !== undefined ? { threads: options.threads } : {}),
    ...(options.device ? { device: options.device } : {}),
    ...(options.mainGpu !== undefined ? { 'main-gpu': options.mainGpu } : {}),
    ...(options.splitMode ? { 'split-mode': options.splitMode } : {}),
    ...(options.tensorSplit ? { 'tensor-split': options.tensorSplit } : {}),
    ...(typeof options.mmap === 'boolean' ? { mmap: options.mmap } : {}),
    ...(options.flashAttn ? { 'flash-attn': options.flashAttn } : {}),
    ...(options.parallel !== undefined ? { parallel: options.parallel } : {}),
    ...(options.reasoning ? { reasoning: options.reasoning } : {}),
    ...(options.reasoningFormat && options.reasoningFormat !== 'auto'
      ? { 'reasoning-format': options.reasoningFormat }
      : {}),
    ...(options.chatTemplate ? { 'chat-template': options.chatTemplate } : {}),
  };
}

function upsertIniSection(
  source: string,
  section: string,
  values: Record<string, string | number | boolean>,
): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `[${section}]`);
  const rendered = [
    `[${section}]`,
    ...Object.entries(values).map(([key, value]) => `${key} = ${value}`),
    '',
  ];
  if (start === -1) {
    return `${source.trimEnd()}\n\n${rendered.join('\n')}`;
  }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[.+\]\s*$/.test(lines[end])) end += 1;
  return [...lines.slice(0, start), ...rendered, ...lines.slice(end)].join('\n').trimEnd() + '\n';
}

function removeEmptyParentDirs(startDir: string, stopDir: string): void {
  let currentDir = path.resolve(startDir);
  const resolvedStopDir = path.resolve(stopDir);

  while (currentDir.startsWith(resolvedStopDir + path.sep)) {
    if (!safeIsDirectoryEmpty(currentDir)) return;
    fs.rmdirSync(currentDir);
    currentDir = path.dirname(currentDir);
  }
}

function safeIsDirectoryEmpty(target: string): boolean {
  try {
    return fs.readdirSync(target).length === 0;
  } catch {
    return false;
  }
}

function isGgufPath(value: string): boolean {
  const pathname = /^https?:\/\//i.test(value) ? new URL(value).pathname : value;
  return pathname.toLowerCase().endsWith('.gguf');
}
