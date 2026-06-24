import { execFile } from 'child_process';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import type {
  LlamaCppBackendListResult,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchResult,
  LlamaCppRunningModel,
  LlamaCppRuntimeBackend as LlamaCppRuntimeBackendType,
  LlamaCppRuntimeCapabilities,
  LlamaCppRuntimeCudaMajor as LlamaCppRuntimeCudaMajorType,
  LlamaCppRuntimeDevice,
  LlamaCppRuntimeImportResult,
  LlamaCppRuntimeInstallResult,
  LlamaCppRuntimeListDevicesResult,
  LlamaCppRuntimeUninstallResult,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import type { LlamaCppBackendRef } from '../../shared/llamacpp';
import {
  LlamaCppRuntimeBackend,
  LlamaCppRuntimeCudaMajor,
  LlamaCppServiceConfigFieldKey,
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
import { LlamaCppClient } from './llamacppClient';
import { LlamaCppRuntimeTargetId } from './llamacppRuntimeConstants';
import {
  createLlamaCppRuntimeInstallPlan,
  executeLlamaCppRuntimeInstallPlan,
  resolveLlamaCppExecutableName,
  resolveLlamaCppRuntimeTargetId,
} from './llamacppRuntimeInstaller';
import { MarketplaceService } from './marketplaceService';
import { getNvidiaSmiSnapshot } from './nvidiaSmi';

const execFileAsync = promisify(execFile);
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = '8080';
const DEFAULT_CONNECTION_AND_LOAD_TIMEOUT_MS = 120_000;
const QUIT_RUNNING_MODELS_TIMEOUT_MS = 1500;
const QUIT_UNLOAD_MODEL_TIMEOUT_MS = 3000;
const LLAMACPP_RUNTIME_PROGRESS_KEY = '__llamacpp_runtime__';
const LLAMACPP_HELP_PROBE_TIMEOUT_MS = 10_000;

type RequestOptions = { signal?: AbortSignal };
type ExecFileRunner = (
  file: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    encoding: 'utf8';
    maxBuffer: number;
    timeout: number;
    windowsHide: boolean;
  },
) => Promise<{ stdout: string; stderr: string }>;

function backendRequiresDeviceValidation(ref: LlamaCppBackendRef): boolean {
  return ref.backend.includes('cuda')
    || ref.backend.includes('vulkan')
    || ref.backend.includes('hip')
    || ref.backend.includes('opencl-adreno');
}

function validateBackendDevices(
  ref: LlamaCppBackendRef,
  devices: LlamaCppRuntimeDevice[],
): string | undefined {
  if (ref.backend.includes('cuda')) {
    return devices.some(device => device.backend === 'cuda')
      ? undefined
      : 'The selected CUDA backend did not detect any CUDA devices.';
  }
  if (ref.backend.includes('vulkan')) {
    return devices.some(device => device.backend === 'vulkan')
      ? undefined
      : 'The selected Vulkan backend did not detect any Vulkan devices.';
  }
  if (ref.backend.includes('hip')) {
    return devices.some(device => device.backend === 'rocm')
      ? undefined
      : 'The selected HIP backend did not detect any HIP/ROCm devices.';
  }
  if (ref.backend.includes('opencl-adreno')) {
    return devices.some(device =>
      device.backend === 'opencl' || /adreno/i.test(device.name) || /adreno/i.test(device.id)
    )
      ? undefined
      : 'The selected OpenCL Adreno backend did not detect any Adreno/OpenCL devices.';
  }
  return undefined;
}

export class LlamaCppManager extends EventEmitter {
  private executablePath: string | null = null;
  private process: ChildProcessWithoutNullStreams | null = null;
  private runtimeContextLengthByModel = new Map<string, number>();
  private startupStderr = '';
  private readonly marketplaceService: MarketplaceService;
  private status: LlamaCppStatusSnapshot = {
    status: 'unknown',
    checkedAt: new Date().toISOString(),
  };

  constructor(
    private readonly getServiceConfig: () => LlamaCppServiceConfig = () => ({}),
    marketplaceService?: MarketplaceService,
  ) {
    super();
    this.marketplaceService = marketplaceService ?? new MarketplaceService(() => this.getModelsDir());
  }

  getStatus(): LlamaCppStatusSnapshot {
    return this.status;
  }

  getBaseUrl(): string {
    const config = this.getServiceConfig();
    const host = config.host?.trim() || DEFAULT_HOST;
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
    const runtimeCapabilities = await this.getRuntimeCapabilities().catch((): null => null);
    const filteredRuntimeConfig = filterLlamaCppServiceConfigByRuntimeCapabilities(
      runtimeConfig,
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

  async loadModel(input: LlamaCppModelLaunchInput): Promise<LlamaCppModelLaunchResult> {
    const modelName = input.model.trim();
    if (!modelName) throw new Error('Model name is required');
    await this.writeModelPreset({ ...input, model: modelName });
    const client = await this.client();
    await client.listModels();
    const result = await client.loadModel({ ...input, model: modelName });
    const resolvedRuntimeContextLength =
      input.options?.ctxSize ?? normalizePositiveInteger(this.getServiceConfig().ctxSize);
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
    return this.hydrateRunningModels(runningModels);
  }

  getRuntimeContextLength(modelName: string): number | undefined {
    return this.runtimeContextLengthByModel.get(modelName.trim());
  }

  async listLocalModels(): Promise<LlamaCppModel[]> {
    let routerModels: LlamaCppModel[] = [];
    try {
      routerModels = await (await this.client()).listModels();
    } catch (error) {
      console.warn('[LlamaCpp] failed to list router models, using local GGUF scan:', error);
    }
    return mergeLocalModels(routerModels, scanLocalGgufModels(this.getModelsDir()));
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
    const safeModelDir = path.join(
      this.getModelsDir(),
      'modelscope',
      ...modelId.split('/').map(sanitizePathSegment),
    );
    fs.mkdirSync(safeModelDir, { recursive: true });
    let request = await this.prefillInstallInputFromMarketplace(input);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.installModelOnce(request, safeModelDir, onProgress, options);
      } catch (error) {
        lastError = error;
        if (attempt > 0 || !isModelDownloadNotFoundError(error)) {
          throw error;
        }
        const refreshed = await this.refreshInstallInputFromMarketplace(request);
        if (!refreshed || isSameInstallRequest(request, refreshed)) {
          throw error;
        }
        request = refreshed;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async prefillInstallInputFromMarketplace(
    input: LlamaCppInstallModelInput,
  ): Promise<LlamaCppInstallModelInput> {
    if (input.downloadUrl?.trim() || input.filePath?.trim()) {
      return input;
    }
    const model = await this.marketplaceService
      .resolveModel(input.modelId.trim())
      .catch((): null => null);
    const filePath = model?.filePath?.trim();
    if (!filePath || !isGgufPath(filePath)) {
      return input;
    }
    return {
      ...input,
      filePath,
    };
  }

  private async installModelOnce(
    input: LlamaCppInstallModelInput,
    safeModelDir: string,
    onProgress?: (progress: LlamaCppInstallProgress) => void,
    options: RequestOptions = {},
  ): Promise<LlamaCppModel> {
    const modelId = input.modelId.trim();
    const resolved = await resolveModelScopeInstallRequest(input);
    const filePath = resolved.filePath;
    const url = resolved.downloadUrl || buildModelScopeFileUrl(modelId, filePath, input.revision);
    const targetPath = resolveModelScopeTargetPath(safeModelDir, filePath);
    const installedThisAttempt = new Set<string>();

    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
      onProgress?.({
        phase: 'done',
        modelId,
        modelName: input.displayName ?? modelId,
        percent: 100,
        targetPath,
      });
      await this.refreshModelsAfterInstall();
      return buildInstalledModelRecord(this.getModelsDir(), targetPath);
    }

    onProgress?.({
      phase: 'downloading',
      modelId,
      modelName: input.displayName ?? modelId,
      targetPath,
    });

    try {
      await downloadFile(
        url,
        targetPath,
        (completed, total) => {
          onProgress?.({
            phase: 'downloading-progress',
            modelId,
            modelName: input.displayName ?? modelId,
            completed,
            total,
            percent: total ? Math.round((completed / total) * 100) : undefined,
            targetPath,
          });
        },
        options.signal,
      );
      installedThisAttempt.add(targetPath);

      if (input.mmprojFilePath?.trim()) {
        const mmprojFilePath = input.mmprojFilePath.trim();
        const mmprojUrl = buildModelScopeFileUrl(modelId, mmprojFilePath, input.revision);
        const mmprojTargetPath = resolveModelScopeTargetPath(safeModelDir, mmprojFilePath);
        onProgress?.({
          phase: 'downloading',
          modelId,
          modelName: input.displayName ?? modelId,
          targetPath: mmprojTargetPath,
        });
        await downloadFile(
          mmprojUrl,
          mmprojTargetPath,
          (completed, total) => {
            onProgress?.({
              phase: 'downloading-progress',
              modelId,
              modelName: input.displayName ?? modelId,
              completed,
              total,
              percent: total ? Math.round((completed / total) * 100) : undefined,
              targetPath: mmprojTargetPath,
            });
          },
          options.signal,
        );
        installedThisAttempt.add(mmprojTargetPath);
      }
    } catch (error) {
      cleanupInstallArtifacts(installedThisAttempt, this.getModelsDir());
      removeEmptyParentDirs(safeModelDir, this.getModelsDir());
      throw error;
    }

    onProgress?.({
      phase: 'done',
      modelId,
      modelName: input.displayName ?? modelId,
      percent: 100,
      targetPath,
    });
    await this.refreshModelsAfterInstall();
    return buildInstalledModelRecord(this.getModelsDir(), targetPath);
  }

  private async refreshInstallInputFromMarketplace(
    input: LlamaCppInstallModelInput,
  ): Promise<LlamaCppInstallModelInput | null> {
    if (input.downloadUrl?.trim()) return null;

    const repoFiles = await fetchModelScopeRepoFiles(input.modelId.trim(), input.revision).catch(
      (): null => null,
    );
    if (repoFiles && repoFiles.length > 0) {
      const filePath = chooseModelScopeInstallFile(repoFiles);
      if (!filePath) {
        return null;
      }
      return {
        ...input,
        filePath,
        mmprojFilePath: input.mmprojFilePath?.trim()
          ? chooseModelScopeMmprojFile(repoFiles)
          : input.mmprojFilePath,
      };
    }

    const model = await this.marketplaceService
      .resolveModel(input.modelId.trim())
      .catch((): null => null);
    const filePath = model?.filePath?.trim();
    if (!filePath || !isGgufPath(filePath)) {
      return null;
    }

    return {
      ...input,
      filePath,
    };
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

  private async writeModelPreset(input: LlamaCppModelLaunchInput): Promise<void> {
    const models = await this.listLocalModels().catch(() => [] as LlamaCppModel[]);
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
      return {
        ...model,
        context_length: trainedContextLength,
        trained_context_length: trainedContextLength,
        runtime_context_length: runtimeContextLength,
        effective_options: runtimeContextLength
          ? { ctxSize: runtimeContextLength }
          : model.effective_options,
      };
    });

    for (const cachedModelName of Array.from(this.runtimeContextLengthByModel.keys())) {
      if (!visibleModelNames.has(cachedModelName)) {
        this.runtimeContextLengthByModel.delete(cachedModelName);
      }
    }

    return hydrated;
  }
}

export function buildLlamaServerArgs(
  config: LlamaCppServiceConfig,
  modelsDir: string,
  presetPath: string,
): string[] {
  const args = [
    '--host',
    config.host?.trim() || DEFAULT_HOST,
    '--port',
    config.port?.trim() || DEFAULT_PORT,
    '--models-dir',
    modelsDir,
    '--models-preset',
    presetPath,
    '--props',
    '--slots',
    '--no-ui',
  ];
  appendArg(args, '--models-max', config.modelsMax);
  if (typeof config.modelsAutoload === 'boolean') {
    args.push(
      config.modelsAutoload && shouldEnableLlamaCppModelsAutoload(config.modelsMax)
        ? '--models-autoload'
        : '--no-models-autoload',
    );
  }
  appendArg(args, '--timeout', config.timeout);
  appendArg(args, '--threads-http', config.threadsHttp);
  appendArg(args, '--cache-reuse', config.cacheReuse);
  appendArg(args, '--cache-ram', config.cacheRam);
  appendArg(args, '--ctx-checkpoints', config.ctxCheckpoints);
  appendArg(args, '--checkpoint-every-n-tokens', config.checkpointEveryNt);
  if (typeof config.cachePrompt === 'boolean') {
    args.push(config.cachePrompt ? '--cache-prompt' : '--no-cache-prompt');
  }
  appendArg(args, '--ctx-size', config.ctxSize);
  appendArg(args, '--parallel', config.parallel);
  appendArg(args, '--batch-size', config.batchSize);
  appendArg(args, '--ubatch-size', config.ubatchSize);
  appendArg(args, '--gpu-layers', config.gpuLayers);
  appendArg(args, '--threads', config.threads);
  appendArg(args, '--threads-batch', config.threadsBatch);
  appendArg(args, '--device', config.device);
  appendArg(args, '--main-gpu', config.mainGpu);
  appendArg(args, '--split-mode', config.splitMode);
  appendArg(args, '--tensor-split', config.tensorSplit);
  appendArg(args, '--flash-attn', config.flashAttn);
  if (config.jinja === 'on') args.push('--jinja');
  if (config.jinja === 'off') args.push('--no-jinja');
  appendArg(args, '--reasoning', config.reasoning);
  if (config.reasoningFormat && config.reasoningFormat !== 'auto') {
    appendArg(args, '--reasoning-format', config.reasoningFormat);
  }
  appendArg(args, '--reasoning-budget', config.reasoningBudget);
  appendArg(args, '--reasoning-budget-message', config.reasoningBudgetMessage);
  appendArg(args, '--chat-template', config.chatTemplate);
  appendArg(args, '--chat-template-file', config.chatTemplateFile);
  if (typeof config.skipChatParsing === 'boolean') {
    args.push(config.skipChatParsing ? '--skip-chat-parsing' : '--no-skip-chat-parsing');
  }
  if (typeof config.prefillAssistant === 'boolean') {
    args.push(config.prefillAssistant ? '--prefill-assistant' : '--no-prefill-assistant');
  }
  if (config.noMmap) args.push('--no-mmap');
  if (config.mlock) args.push('--mlock');
  return args;
}

export function filterLlamaCppServiceConfigByRuntimeCapabilities(
  config: LlamaCppServiceConfig,
  runtimeCapabilities: LlamaCppRuntimeCapabilities | null | undefined,
): LlamaCppServiceConfig {
  if (!runtimeCapabilities) return config;

  const next: LlamaCppServiceConfig = { ...config };
  const supports = runtimeCapabilities.supports ?? {};
  const clearWhenUnsupported = (
    key: keyof LlamaCppServiceConfig,
    supportKey: LlamaCppServiceConfigFieldKey,
  ) => {
    if (supports[supportKey] === false) {
      delete next[key];
    }
  };

  clearWhenUnsupported('modelsMax', LlamaCppServiceConfigFieldKey.ModelsMax);
  clearWhenUnsupported('modelsAutoload', LlamaCppServiceConfigFieldKey.ModelsAutoload);
  clearWhenUnsupported('timeout', LlamaCppServiceConfigFieldKey.Timeout);
  clearWhenUnsupported('threadsHttp', LlamaCppServiceConfigFieldKey.ThreadsHttp);
  clearWhenUnsupported('parallel', LlamaCppServiceConfigFieldKey.Parallel);
  clearWhenUnsupported('cachePrompt', LlamaCppServiceConfigFieldKey.CachePrompt);
  clearWhenUnsupported('cacheReuse', LlamaCppServiceConfigFieldKey.CacheReuse);
  clearWhenUnsupported('cacheRam', LlamaCppServiceConfigFieldKey.CacheRam);
  clearWhenUnsupported('device', LlamaCppServiceConfigFieldKey.Device);
  clearWhenUnsupported('splitMode', LlamaCppServiceConfigFieldKey.SplitMode);
  clearWhenUnsupported('tensorSplit', LlamaCppServiceConfigFieldKey.TensorSplit);
  clearWhenUnsupported('mainGpu', LlamaCppServiceConfigFieldKey.MainGpu);
  clearWhenUnsupported('flashAttn', LlamaCppServiceConfigFieldKey.FlashAttn);
  clearWhenUnsupported('jinja', LlamaCppServiceConfigFieldKey.Jinja);
  clearWhenUnsupported('mlock', LlamaCppServiceConfigFieldKey.Mlock);

  if (next.cachePrompt === false) {
    delete next.cacheReuse;
    delete next.cacheRam;
  }
  if (next.splitMode !== 'tensor') {
    delete next.tensorSplit;
  }
  if (runtimeCapabilities.deviceProbeSucceeded && runtimeCapabilities.gpuDeviceCount <= 1) {
    delete next.device;
    delete next.splitMode;
    delete next.tensorSplit;
    delete next.mainGpu;
  }

  return next;
}

function appendArg(args: string[], name: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  args.push(name, trimmed);
}

export function shouldEnableLlamaCppModelsAutoload(modelsMax: string | undefined): boolean {
  return normalizePositiveInteger(modelsMax) === 1;
}

function normalizePositiveInteger(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function buildLlamaCppServeEnv(
  baseEnv: NodeJS.ProcessEnv,
  executablePath: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const runtimeBinDir = resolveExecutableDir(executablePath, platform);
  if (!runtimeBinDir) return env;

  if (platform === 'win32') {
    prependEnvPathEntry(env, 'PATH', runtimeBinDir, platform);
    return env;
  }
  if (platform === 'linux') {
    prependEnvPathEntry(env, 'LD_LIBRARY_PATH', runtimeBinDir, platform);
  }
  return env;
}

export async function listLlamaCppRuntimeHelpFlags(input: {
  executablePath: string;
  platform: NodeJS.Platform;
  baseEnv?: NodeJS.ProcessEnv;
  runner?: ExecFileRunner;
}): Promise<{
  success: boolean;
  flags: string[];
  rawOutput?: string;
  error?: string;
}> {
  const runner = input.runner ?? (execFileAsync as ExecFileRunner);
  try {
    const { stdout, stderr } = await runner(input.executablePath, ['--help'], {
      env: buildLlamaCppServeEnv(input.baseEnv ?? process.env, input.executablePath, input.platform),
      encoding: 'utf8',
      maxBuffer: 512 * 1024,
      timeout: LLAMACPP_HELP_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    const rawOutput = [stdout, stderr].filter(Boolean).join(stderr ? '\n' : '');
    return {
      success: true,
      flags: parseLlamaCppHelpFlags(rawOutput),
      rawOutput,
    };
  } catch (error) {
    return {
      success: false,
      flags: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseLlamaCppHelpFlags(output: string): string[] {
  const flags = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const matches = line.match(/--[a-z0-9][a-z0-9-]*/gi);
    if (!matches) continue;
    matches.forEach(flag => flags.add(flag.toLowerCase()));
  }
  return Array.from(flags).sort();
}

export async function listLlamaCppRuntimeDevices(input: {
  executablePath: string;
  platform: NodeJS.Platform;
  baseEnv?: NodeJS.ProcessEnv;
  runner?: ExecFileRunner;
}): Promise<LlamaCppRuntimeListDevicesResult> {
  const runner = input.runner ?? (execFileAsync as ExecFileRunner);
  const metadata = resolveLlamaCppRuntimeMetadata(input.executablePath);
  try {
    const { stdout, stderr } = await runner(input.executablePath, ['--list-devices'], {
      env: buildLlamaCppServeEnv(input.baseEnv ?? process.env, input.executablePath, input.platform),
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      timeout: 10_000,
      windowsHide: true,
    });
    const rawOutput = [stdout, stderr].filter(Boolean).join(stderr ? '\n' : '');
    return {
      success: true,
      executablePath: input.executablePath,
      runtimeTargetId: metadata.runtimeTargetId,
      rawOutput,
      devices: parseLlamaCppListDevicesOutput(rawOutput),
    };
  } catch (error) {
    return {
      success: false,
      executablePath: input.executablePath,
      runtimeTargetId: metadata.runtimeTargetId,
      devices: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseLlamaCppListDevicesOutput(output: string): LlamaCppRuntimeDevice[] {
  const devices: LlamaCppRuntimeDevice[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^available devices:?$/i.test(trimmed)) continue;
    const match = trimmed.match(/^([A-Za-z]+[\w.-]*)\s*:\s*(.+)$/);
    if (!match) continue;
    const id = match[1].trim();
    if (id.toUpperCase() !== 'CPU' && !/\d+$/.test(id)) continue;
    const rawName = match[2].replace(/\s*\([^)]*\)\s*$/, '').trim();
    const backend = inferLlamaCppDeviceBackend(id, rawName);
    devices.push({
      id,
      name: rawName || id,
      backend,
    });
  }
  return devices;
}

export function resolveLlamaCppDeviceSelection(
  rawValue: string,
  devices: LlamaCppRuntimeDevice[],
): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  if (!parts.every(part => /^\d+$/.test(part))) {
    return parts.every(part => devices.some(device => device.id === part || device.name === part))
      ? parts.join(',')
      : '';
  }

  const resolved = parts.map(part => {
    const index = Number.parseInt(part, 10);
    const device = devices[index];
    return device?.id;
  });
  if (resolved.some(part => !part)) return '';
  return resolved.join(',');
}

function inferLlamaCppDeviceBackend(id: string, name: string): string {
  const source = `${id} ${name}`.toLowerCase();
  if (source.includes('cuda')) return 'cuda';
  if (source.includes('metal')) return 'metal';
  if (source.includes('vulkan')) return 'vulkan';
  if (source.includes('opencl') || source.includes('adreno')) return 'opencl';
  if (source.includes('rocm') || source.includes('hip')) return 'rocm';
  if (source.includes('sycl')) return 'sycl';
  if (source.includes('cpu')) return 'cpu';
  return 'unknown';
}

function isGpuLikeRuntimeDevice(device: LlamaCppRuntimeDevice): boolean {
  return device.backend !== 'cpu' && device.backend !== 'unknown';
}

function buildLlamaCppServiceConfigFieldSupport(input: {
  helpProbeSucceeded: boolean;
  flags: string[];
  devices: LlamaCppRuntimeDevice[];
  runtimeBackend?: LlamaCppRuntimeBackendType;
}): Partial<Record<LlamaCppServiceConfigFieldKey, boolean>> {
  const flags = new Set(input.flags.map(flag => flag.toLowerCase()));
  const gpuDevices = input.devices.filter(device => isGpuLikeRuntimeDevice(device));
  const hasGpu = gpuDevices.length > 0 || input.runtimeBackend === LlamaCppRuntimeBackend.Cuda;
  const hasMultiGpu = gpuDevices.length > 1;
  const hasFlag = (...names: string[]) => names.some(name => flags.has(name.toLowerCase()));
  const unknownHelpSupport = !input.helpProbeSucceeded;

  return {
    [LlamaCppServiceConfigFieldKey.ModelsMax]: unknownHelpSupport || hasFlag('--models-max'),
    [LlamaCppServiceConfigFieldKey.ModelsAutoload]:
      unknownHelpSupport || hasFlag('--models-autoload', '--no-models-autoload'),
    [LlamaCppServiceConfigFieldKey.Timeout]: unknownHelpSupport || hasFlag('--timeout'),
    [LlamaCppServiceConfigFieldKey.ThreadsHttp]: unknownHelpSupport || hasFlag('--threads-http'),
    [LlamaCppServiceConfigFieldKey.Parallel]: unknownHelpSupport || hasFlag('--parallel'),
    [LlamaCppServiceConfigFieldKey.CachePrompt]:
      unknownHelpSupport || hasFlag('--cache-prompt', '--no-cache-prompt'),
    [LlamaCppServiceConfigFieldKey.CacheReuse]: unknownHelpSupport || hasFlag('--cache-reuse'),
    [LlamaCppServiceConfigFieldKey.CacheRam]: unknownHelpSupport || hasFlag('--cache-ram'),
    [LlamaCppServiceConfigFieldKey.Device]:
      hasGpu && (unknownHelpSupport || hasFlag('--device')),
    [LlamaCppServiceConfigFieldKey.SplitMode]:
      hasMultiGpu && (unknownHelpSupport || hasFlag('--split-mode')),
    [LlamaCppServiceConfigFieldKey.TensorSplit]:
      hasMultiGpu && (unknownHelpSupport || hasFlag('--tensor-split')),
    [LlamaCppServiceConfigFieldKey.MainGpu]:
      hasMultiGpu && (unknownHelpSupport || hasFlag('--main-gpu')),
    [LlamaCppServiceConfigFieldKey.FlashAttn]:
      hasGpu && (unknownHelpSupport || hasFlag('--flash-attn')),
    [LlamaCppServiceConfigFieldKey.Jinja]: unknownHelpSupport || hasFlag('--jinja', '--no-jinja'),
    [LlamaCppServiceConfigFieldKey.Mlock]: unknownHelpSupport || hasFlag('--mlock'),
  };
}

export async function findLlamaCppExecutable(_config: LlamaCppServiceConfig = {}): Promise<string | null> {
  for (const candidate of buildLlamaCppExecutableCandidates({
    platform: process.platform,
    isPackaged: app.isPackaged,
    resourceRoot: process.resourcesPath || path.join(__dirname, '..', '..'),
    appRoot: path.join(__dirname, '..', '..'),
    cwd: process.cwd(),
    userRuntimeRoot: getUserLlamaCppRuntimeRoot(),
    envPath: process.env.LLAMACPP_BIN,
  })) {
    if (fs.existsSync(candidate)) return candidate;
  }

  if (app.isPackaged) {
    return null;
  }

  const command = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(command, ['llama-server'], { timeout: 1000 });
    const first = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

async function findExternalLlamaCppExecutable(_config: LlamaCppServiceConfig = {}): Promise<string | null> {
  for (const candidate of buildLlamaCppExecutableCandidates({
    platform: process.platform,
    isPackaged: app.isPackaged,
    resourceRoot: process.resourcesPath || path.join(__dirname, '..', '..'),
    appRoot: path.join(__dirname, '..', '..'),
    cwd: process.cwd(),
    userRuntimeRoot: getUserLlamaCppRuntimeRoot(),
    envPath: process.env.LLAMACPP_BIN,
  })) {
    if (!fs.existsSync(candidate)) continue;
    if (isPathInside(candidate, getUserLlamaCppRuntimeRoot())) continue;
    return candidate;
  }
  return null;
}

export function buildLlamaCppExecutableCandidates(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  resourceRoot: string;
  appRoot: string;
  cwd: string;
  userRuntimeRoot: string;
  envPath?: string;
}): string[] {
  const extension = input.platform === 'win32' ? '.exe' : '';
  const candidates = [
    input.envPath?.trim(),
    path.join(input.userRuntimeRoot, 'current', 'build', 'bin', `llama-server${extension}`),
    path.join(input.userRuntimeRoot, 'current', 'bin', `llama-server${extension}`),
    path.join(input.userRuntimeRoot, 'current', `llama-server${extension}`),
    path.join(input.resourceRoot, 'llamacpp', `llama-server${extension}`),
    path.join(input.resourceRoot, 'llamacpp', 'bin', `llama-server${extension}`),
  ];

  if (!input.isPackaged) {
    candidates.push(
      path.join(input.appRoot, 'vendor', 'llamacpp-runtime', 'current', `llama-server${extension}`),
      path.join(input.appRoot, 'vendor', 'llamacpp-runtime', 'current', 'build', 'bin', `llama-server${extension}`),
      path.join(input.appRoot, 'vendor', 'llamacpp-runtime', 'current', 'bin', `llama-server${extension}`),
      path.join(input.cwd, 'vendor', 'llamacpp-runtime', 'current', `llama-server${extension}`),
      path.join(input.cwd, 'vendor', 'llamacpp-runtime', 'current', 'build', 'bin', `llama-server${extension}`),
      path.join(input.cwd, 'vendor', 'llamacpp-runtime', 'current', 'bin', `llama-server${extension}`),
      '/opt/homebrew/bin/llama-server',
      '/usr/local/bin/llama-server',
      '/usr/bin/llama-server',
    );
  }

  return Array.from(new Set(candidates.filter((candidate): candidate is string => Boolean(candidate))));
}

function getUserLlamaCppRuntimeRoot(): string {
  return path.join(app.getPath('userData'), 'llamacpp-runtime');
}

export function resolveLlamaCppRuntimeTargetPreference(config: LlamaCppServiceConfig): {
  runtimeBackend: LlamaCppRuntimeBackendType;
  runtimeCudaMajor: LlamaCppRuntimeCudaMajorType;
} {
  return {
    runtimeBackend: config.runtimeBackend ?? LlamaCppRuntimeBackend.Auto,
    runtimeCudaMajor: config.runtimeCudaMajor ?? LlamaCppRuntimeCudaMajor.Cuda12,
  };
}

export function selectLlamaCppRuntimeTarget(input: {
  platform: NodeJS.Platform;
  arch: string;
  runtimeBackend: LlamaCppRuntimeBackendType;
  runtimeCudaMajor: LlamaCppRuntimeCudaMajorType;
  hasNvidiaGpu: boolean;
}): { ok: true; targetId: string } | { ok: false; error: string } {
  const baseTargetId = resolveLlamaCppRuntimeTargetId(input.platform, input.arch);
  if (!baseTargetId) {
    return {
      ok: false,
      error: `Unsupported platform for llama.cpp runtime: ${input.platform}/${input.arch}.`,
    };
  }

  if (input.platform !== 'win32') {
    return { ok: true, targetId: baseTargetId };
  }

  if (baseTargetId !== LlamaCppRuntimeTargetId.WinX64) {
    if (input.runtimeBackend === LlamaCppRuntimeBackend.Cuda) {
      return {
        ok: false,
        error: 'CUDA runtime is only supported on Windows x64.',
      };
    }
    return { ok: true, targetId: baseTargetId };
  }

  if (input.runtimeBackend === LlamaCppRuntimeBackend.Cpu) {
    return { ok: true, targetId: LlamaCppRuntimeTargetId.WinX64 };
  }
  if (input.runtimeBackend === LlamaCppRuntimeBackend.Cuda) {
    if (!input.hasNvidiaGpu) {
      return { ok: false, error: 'CUDA runtime requires an NVIDIA GPU on Windows.' };
    }
    return { ok: true, targetId: LlamaCppRuntimeTargetId.WinX64Cuda12 };
  }

  return {
    ok: true,
    targetId: input.hasNvidiaGpu
      ? LlamaCppRuntimeTargetId.WinX64Cuda12
      : LlamaCppRuntimeTargetId.WinX64,
  };
}

function resolveLlamaCppRuntimeMetadata(executablePath: string | undefined): Partial<LlamaCppStatusSnapshot> {
  if (!executablePath) {
    return {
      runtimeTargetId: undefined,
      runtimeBackend: undefined,
      runtimeCudaMajor: undefined,
      runtimeRoot: undefined,
      deviceProbeAvailable: false,
    };
  }
  const runtimeRoot = getManagedRuntimeRootForExecutable(executablePath);
  const buildInfo = runtimeRoot ? readRuntimeBuildMetadata(runtimeRoot) : undefined;
  const targetId = buildInfo?.target;
  const version = buildInfo?.version;
  const backend = buildInfo?.backend ?? targetId;
  return {
    ...(version ? { runtimeVersion: version } : {}),
    ...(backend ? { runtimeBackendId: backend } : {}),
    ...(version && backend ? { versionBackend: `${version}/${backend}` } : {}),
    ...(buildInfo?.source ? { runtimeSource: buildInfo.source } : {}),
    ...(targetId ? { runtimeTargetId: targetId } : {}),
    ...runtimeBackendFieldsFromTargetId(targetId),
    ...(runtimeRoot ? { runtimeRoot } : {}),
    deviceProbeAvailable: true,
  };
}

function getManagedRuntimeRootForExecutable(executablePath: string): string | undefined {
  const userRuntimeRoot = getUserLlamaCppRuntimeRoot();
  const userCurrentRoot = path.join(userRuntimeRoot, 'current');
  if (isPathInside(executablePath, userCurrentRoot)) {
    return userCurrentRoot;
  }

  const cwdCurrentRoot = path.join(process.cwd(), 'vendor', 'llamacpp-runtime', 'current');
  if (isPathInside(executablePath, cwdCurrentRoot)) {
    return cwdCurrentRoot;
  }
  return undefined;
}

function readRuntimeBuildMetadata(runtimeRoot: string): {
  target?: string;
  backend?: string;
  version?: string;
  source?: string;
} | undefined {
  const buildInfoPath = path.join(runtimeRoot, 'runtime-build-info.json');
  try {
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf-8')) as {
      target?: string;
      targetId?: string;
      backend?: string;
      version?: string;
      source?: string;
    };
    const target = buildInfo.target?.trim() || buildInfo.targetId?.trim() || buildInfo.backend?.trim();
    return {
      ...(target ? { target } : {}),
      ...(buildInfo.backend?.trim() ? { backend: buildInfo.backend.trim() } : {}),
      ...(buildInfo.version?.trim() ? { version: buildInfo.version.trim() } : {}),
      ...(buildInfo.source?.trim() ? { source: buildInfo.source.trim() } : {}),
    };
  } catch {
    return undefined;
  }
}

function runtimeBackendFieldsFromTargetId(
  targetId: string | undefined,
): Pick<Partial<LlamaCppStatusSnapshot>, 'runtimeBackend' | 'runtimeCudaMajor'> {
  if (targetId === LlamaCppRuntimeTargetId.WinX64Cuda12) {
    return {
      runtimeBackend: LlamaCppRuntimeBackend.Cuda,
      runtimeCudaMajor: LlamaCppRuntimeCudaMajor.Cuda12,
    };
  }
  if (targetId?.includes('cuda')) {
    return { runtimeBackend: LlamaCppRuntimeBackend.Cuda };
  }
  if (targetId) {
    return { runtimeBackend: LlamaCppRuntimeBackend.Cpu };
  }
  return {};
}

function resolveExecutableDir(executablePath: string, platform: NodeJS.Platform): string {
  const normalizedPath = executablePath.trim();
  if (!normalizedPath) return '';
  return platform === 'win32'
    ? path.win32.dirname(normalizedPath)
    : path.dirname(normalizedPath);
}

function prependEnvPathEntry(
  env: NodeJS.ProcessEnv,
  variableName: 'PATH' | 'LD_LIBRARY_PATH',
  entry: string,
  platform: NodeJS.Platform,
): void {
  const delimiter = platform === 'win32' ? ';' : ':';
  const key = Object.keys(env).find(name => name.toUpperCase() === variableName) ?? variableName;
  const currentValue = env[key]?.trim() ?? '';
  const entries = currentValue
    ? currentValue.split(delimiter).map(item => item.trim()).filter(Boolean)
    : [];
  if (entries.includes(entry)) {
    env[key] = entries.join(delimiter);
    return;
  }
  env[key] = [entry, ...entries].join(delimiter);
}

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

export async function resolveModelScopeInstallRequest(input: LlamaCppInstallModelInput): Promise<{
  filePath: string;
  downloadUrl?: string;
}> {
  const downloadUrl = input.downloadUrl?.trim();
  if (downloadUrl) {
    const filePath =
      input.filePath?.trim() ||
      new URL(downloadUrl).pathname.split('/').filter(Boolean).pop() ||
      'model.gguf';
    if (!isGgufPath(filePath)) {
      throw new Error('Only GGUF model files can be installed for llama.cpp.');
    }
    return { filePath, downloadUrl };
  }

  const explicitFilePath = input.filePath?.trim();
  if (explicitFilePath) {
    if (!isGgufPath(explicitFilePath)) {
      throw new Error('Only GGUF model files can be installed for llama.cpp.');
    }
    const modelId = input.modelId.trim();
    try {
      const files = await fetchModelScopeRepoFiles(modelId, input.revision);
      const matchedFile = resolveExplicitModelScopeInstallFile(files, explicitFilePath);
      if (matchedFile) {
        return { filePath: matchedFile };
      }
      const ggufFile = chooseModelScopeInstallFile(files);
      if (ggufFile) {
        return { filePath: ggufFile };
      }
    } catch {
      // Keep the explicit file path as the fallback when repo metadata is unavailable.
    }
    return { filePath: explicitFilePath };
  }

  const modelId = input.modelId.trim();
  const files = await fetchModelScopeRepoFiles(modelId, input.revision);
  const ggufFile = chooseModelScopeInstallFile(files);
  if (!ggufFile) {
    throw new Error(
      `No GGUF files were found in ModelScope model ${modelId}. Use a GGUF repository or specify owner/repo::file.gguf.`,
    );
  }
  return { filePath: ggufFile };
}

function resolveExplicitModelScopeInstallFile(
  files: string[],
  explicitFilePath: string,
): string | undefined {
  const normalizedExplicit = normalizeModelScopeFilePath(explicitFilePath);
  const exactMatch = files.find(file => normalizeModelScopeFilePath(file) === normalizedExplicit);
  if (exactMatch) return exactMatch;

  const explicitBaseName = path.basename(normalizedExplicit);
  return files.find(file => path.basename(normalizeModelScopeFilePath(file)) === explicitBaseName);
}

export function buildModelScopeFileUrl(
  modelId: string,
  filePath: string,
  revision = 'master',
): string {
  const [owner, repo] = modelId.split('/');
  if (!owner || !repo) throw new Error('ModelScope model ID must be in owner/repo format.');
  // ModelScope LFS files use the /resolve/ endpoint (302 → CDN), not /repo?
  // which returns Code 10990101007 for LFS objects.
  return `https://www.modelscope.cn/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/resolve/${encodeURIComponent(revision)}/${encodeURIComponent(filePath)}`;
}

async function fetchModelScopeRepoFiles(modelId: string, revision = 'master'): Promise<string[]> {
  const [owner, repo] = modelId.split('/');
  if (!owner || !repo) throw new Error('ModelScope model ID must be in owner/repo format.');
  const params = new URLSearchParams({
    Revision: revision,
    Recursive: 'true',
  });
  let response: Response;
  try {
    response = await fetch(
      `https://www.modelscope.cn/api/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/repo/files?${params.toString()}`,
      {
        headers: { 'User-Agent': 'RongxinAI/modelscope-gguf-installer' },
      },
    );
  } catch {
    throw new Error(
      'Unable to connect to ModelScope. Please check your network connection or proxy settings.',
    );
  }
  if (!response.ok) {
    throw new Error(`Failed to read ModelScope model files: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return extractModelScopeFilePaths(payload);
}

export function extractModelScopeFilePaths(payload: unknown): string[] {
  const records = extractRecords(payload);
  const paths = records
    .map(
      record =>
        readRecordString(record.Path) ||
        readRecordString(record.path) ||
        readRecordString(record.FilePath) ||
        readRecordString(record.filePath) ||
        readRecordString(record.Name) ||
        readRecordString(record.name),
    )
    .filter((value): value is string => Boolean(value));
  return [...new Set(paths)];
}

export function chooseModelScopeInstallFile(files: string[]): string | undefined {
  const ggufFiles = files.filter(file => isGgufPath(file) && !/^mmproj/i.test(path.basename(file)));
  if (ggufFiles.length === 0) return undefined;
  const preferred = ['q4_k_m', 'q5_k_m', 'q4_0', 'q8_0'];
  for (const quantization of preferred) {
    const match = ggufFiles.find(file => path.basename(file).toLowerCase().includes(quantization));
    if (match) return match;
  }
  return ggufFiles.sort((a, b) => a.localeCompare(b))[0];
}

export function chooseModelScopeMmprojFile(files: string[]): string | undefined {
  const mmprojFiles = files.filter(file => /^mmproj/i.test(path.basename(file)) && isGgufPath(file));
  if (mmprojFiles.length === 0) return undefined;
  const preferred = mmprojFiles.find(file => /f16/i.test(path.basename(file)));
  return preferred ?? mmprojFiles.sort((a, b) => a.localeCompare(b))[0];
}

export function scanLocalGgufModels(modelsDir: string): LlamaCppModel[] {
  const root = path.resolve(modelsDir);
  if (!fs.existsSync(root)) return [];
  const files = walkGgufFiles(root).filter(filePath => !/^mmproj/i.test(path.basename(filePath)));
  const nameCounts = new Map<string, number>();
  return files.map(filePath => {
    const baseName = resolveInstalledModelName(root, filePath);
    const count = nameCounts.get(baseName) ?? 0;
    nameCounts.set(baseName, count + 1);
    const name = count === 0 ? baseName : `${baseName}/${path.basename(filePath, '.gguf')}`;
    const stat = fs.statSync(filePath);
    return {
      name,
      id: name,
      model: name,
      path: filePath,
      modified_at: stat.mtime.toISOString(),
      size: stat.size,
      source: filePath.includes(`${path.sep}modelscope${path.sep}`) ? 'modelscope' : 'local',
      status: 'unloaded',
      details: {
        format: 'gguf',
        quantization_level: inferQuantizationFromFilename(path.basename(filePath)),
      },
    };
  });
}

export function mergeLocalModels(
  routerModels: LlamaCppModel[],
  scannedModels: LlamaCppModel[],
  modelsDir?: string,
): LlamaCppModel[] {
  const merged = new Map<string, LlamaCppModel>();
  for (const model of scannedModels) {
    merged.set(model.path ? `path:${path.resolve(model.path)}` : `name:${model.name}`, model);
  }
  for (const model of routerModels) {
    if (!model.path || !isGgufPath(model.path)) continue;
    const pathKey = model.path ? `path:${path.resolve(model.path)}` : undefined;
    if (modelsDir && pathKey && !isPathInside(path.resolve(model.path), path.resolve(modelsDir))) {
      merged.set(pathKey, model);
      continue;
    }
    const existing = pathKey ? merged.get(pathKey) : undefined;
    merged.set(pathKey ?? `name:${model.name}`, {
      ...existing,
      ...model,
      path: model.path ?? existing?.path,
      size: model.size ?? existing?.size,
      modified_at: model.modified_at ?? existing?.modified_at,
      details: { ...existing?.details, ...model.details },
    });
  }
  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function isPathInside(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function walkGgufFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of safeReadDir(dir)) {
    const candidate = path.join(dir, entry);
    if (safeIsDirectory(candidate)) {
      files.push(...walkGgufFiles(candidate));
    } else if (candidate.toLowerCase().endsWith('.gguf')) {
      files.push(candidate);
    }
  }
  return files;
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function safeIsDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function resolveInstalledModelName(modelsDir: string, modelPath: string): string {
  const root = path.resolve(modelsDir);
  const target = path.resolve(modelPath);
  const relative = path.relative(root, target);
  const parent = path.dirname(relative);
  if (!parent || parent === '.') return path.basename(target, '.gguf');
  return path.basename(parent);
}

function inferQuantizationFromFilename(fileName: string): string | undefined {
  return fileName
    .toUpperCase()
    .match(/\b(Q[2-8](?:_[A-Z0-9]+){0,3}|F16|F32|BF16|IQ[1-4]_[A-Z0-9_]+)\b/)?.[1];
}

function extractRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  const records: Record<string, unknown>[] = [];
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      if (item.every(isRecord)) records.push(...item);
      item.forEach(child => stack.push(child));
      continue;
    }
    if (!isRecord(item)) continue;
    Object.values(item).forEach(child => {
      if (Array.isArray(child) || isRecord(child)) stack.push(child);
    });
  }
  return records;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecordString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isGgufPath(value: string): boolean {
  const pathname = /^https?:\/\//i.test(value) ? new URL(value).pathname : value;
  return pathname.toLowerCase().endsWith('.gguf');
}

function normalizeModelScopeFilePath(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
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

function cleanupInstallArtifacts(paths: Iterable<string>, rootDir: string): void {
  const resolvedRootDir = path.resolve(rootDir);
  for (const candidate of paths) {
    const target = path.resolve(candidate);
    if (!target.startsWith(resolvedRootDir + path.sep) && target !== resolvedRootDir) continue;
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true, recursive: true });
    }
    removeEmptyParentDirs(path.dirname(target), resolvedRootDir);
  }
}

function safeIsDirectoryEmpty(target: string): boolean {
  try {
    return fs.readdirSync(target).length === 0;
  } catch {
    return false;
  }
}

function resolveModelScopeTargetPath(modelDir: string, filePath: string): string {
  const segments = filePath
    .split(/[\\/]+/)
    .map(sanitizePathSegment)
    .filter(Boolean);
  const fileName = segments.pop() || 'model.gguf';
  const normalizedFileName = fileName.toLowerCase().endsWith('.gguf')
    ? fileName
    : `${fileName}.gguf`;
  const targetDir = path.join(modelDir, ...segments);
  fs.mkdirSync(targetDir, { recursive: true });
  return path.join(targetDir, normalizedFileName);
}

function buildInstalledModelRecord(modelsDir: string, targetPath: string): LlamaCppModel {
  const modelName = resolveInstalledModelName(modelsDir, targetPath);
  return {
    name: modelName,
    id: modelName,
    model: modelName,
    path: targetPath,
    size: fs.statSync(targetPath).size,
    source: 'modelscope',
    status: 'unloaded',
    details: { format: 'gguf' },
  };
}

function isModelDownloadNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Model download failed: HTTP 404');
}

function isSameInstallRequest(
  previous: LlamaCppInstallModelInput,
  next: LlamaCppInstallModelInput,
): boolean {
  return (previous.filePath?.trim() ?? '') === (next.filePath?.trim() ?? '')
    && (previous.mmprojFilePath?.trim() ?? '') === (next.mmprojFilePath?.trim() ?? '')
    && (previous.downloadUrl?.trim() ?? '') === (next.downloadUrl?.trim() ?? '');
}

async function downloadFile(
  url: string,
  targetPath: string,
  onProgress: (completed: number, total?: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const tempPath = `${targetPath}.download`;
  let completedSuccessfully = false;
  try {
    const resumeFrom = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
    let response: Response;
    try {
      response = await fetch(url, {
        signal,
        ...(resumeFrom > 0 ? { headers: { Range: `bytes=${resumeFrom}-` } } : {}),
      });
    } catch {
    throw new Error(
      'Model download failed due to network error. Please check your network connection or proxy settings.',
    );
    }
    if (!response.ok || !response.body) {
      throw new Error(`Model download failed: HTTP ${response.status}`);
    }
    const resumed = resumeFrom > 0 && response.status === 206;
    const totalHeader = response.headers.get('content-length');
    const contentRangeTotal = parseContentRangeTotal(response.headers.get('content-range'));
    const total =
      contentRangeTotal ??
      (totalHeader ? Number(totalHeader) + (resumed ? resumeFrom : 0) : undefined);
    const file = fs.createWriteStream(tempPath, { flags: resumed ? 'a' : 'w' });
    const reader = response.body.getReader();
    const onAbort = () => {
      void reader.cancel();
    };
    signal?.addEventListener('abort', onAbort);
    let completed = resumed ? resumeFrom : 0;
    try {
      if (completed > 0) onProgress(completed, Number.isFinite(total) ? total : undefined);
      while (true) {
        if (signal?.aborted) throw new Error('Install cancelled');
        const { value, done } = await reader.read();
        if (signal?.aborted) throw new Error('Install cancelled');
        if (done) break;
        completed += value.byteLength;
        if (!file.write(Buffer.from(value))) {
          await new Promise<void>(resolve => file.once('drain', resolve));
        }
        onProgress(completed, Number.isFinite(total) ? total : undefined);
      }
      completedSuccessfully = true;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      void reader.cancel();
      await new Promise<void>(resolve => file.end(resolve));
    }
    if (completedSuccessfully) {
      fs.renameSync(tempPath, targetPath);
    }
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
    throw error;
  }
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '_') || 'model';
}

function parseContentRangeTotal(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\/(\d+)$/);
  if (!match) return undefined;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : undefined;
}
