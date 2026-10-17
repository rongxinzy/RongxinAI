// Runtime/backend install, selection, and capability probing (#1069).
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

import { LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID } from '../../../shared/llamacpp';
import type {
  LlamaCppBackendListResult,
  LlamaCppBackendRef,
  LlamaCppInstallProgress,
  LlamaCppRuntimeCapabilities,
  LlamaCppRuntimeImportResult,
  LlamaCppRuntimeInstallResult,
  LlamaCppRuntimeListDevicesResult,
  LlamaCppRuntimeUninstallResult,
} from '../../../shared/llamacpp';
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
  resolveLlamaCppBackendDownloadSize,
  syncCurrentBackend,
  uninstallLlamaCppBackend,
} from '../llamacppBackendManager';
import {
  backendRequiresDeviceValidation,
  validateBackendDevices,
} from '../llamacppBackendValidation';
import {
  prepareLlamaCppBackendVersionSwitch,
  restartLlamaCppBackendVersionService,
} from '../llamacppBackendVersionSwitch';
import { isPathInside } from '../llamacppModelCatalog';
import {
  createLlamaCppRuntimeInstallPlan,
  executeLlamaCppRuntimeInstallPlan,
  resolveLlamaCppExecutableName,
} from '../llamacppRuntimeInstaller';
import {
  findExternalLlamaCppExecutable,
  findLlamaCppExecutable,
  getUserLlamaCppRuntimeRoot,
} from '../llamacppRuntimePaths';
import {
  buildLlamaCppServiceConfigFieldSupport,
  isGpuLikeRuntimeDevice,
  listLlamaCppRuntimeHelpFlags,
} from '../llamacppServe';
import { listLlamaCppRuntimeDevices } from '../llamacppRuntimeDeviceProbe';
import { getNvidiaSmiSnapshot } from '../nvidiaSmi';
import { LlamaCppManagerCore } from './core';
import type { LlamaCppManagerDownstreamSurface } from './types';
import { resolveLlamaCppDeviceSelection } from '../llamacppServe';

const LLAMACPP_RUNTIME_PROGRESS_KEY = LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID;
const LLAMACPP_BACKEND_LIST_CACHE_TTL_MS = 60_000;

export class LlamaCppManagerBackendOps extends LlamaCppManagerCore {
  protected async resolveRuntimeServiceConfig(): Promise<
    import('../../../shared/llamacpp').LlamaCppServiceConfig
  > {
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

  async installRuntime(
    options: { signal?: AbortSignal } = {},
  ): Promise<LlamaCppRuntimeInstallResult> {
    this.clearBackendListCache();
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
      signal: options.signal,
      onProgress: progress => {
        this.emit('install-progress', {
          ...progress,
          modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
          modelName: ref.versionBackend,
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
        phase: result.cancelled ? 'cancelled' : 'failed',
        modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
        modelName: ref.versionBackend,
        error: result.cancelled ? undefined : 'error' in result ? result.error : undefined,
      } satisfies LlamaCppInstallProgress);
    }
    return result;
  }

  async listBackends(): Promise<LlamaCppBackendListResult> {
    const cacheKey = this.getBackendListCacheKey();
    const cached = this.backendListCache;
    if (cached && cached.key === cacheKey && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    try {
      const nvidiaSnapshot = process.platform === 'win32' ? await getNvidiaSmiSnapshot() : null;
      const result = await listLlamaCppBackends({
        runtimeRoot: getUserLlamaCppRuntimeRoot(),
        platform: process.platform,
        arch: process.arch,
        hasNvidiaGpu: Boolean(nvidiaSnapshot?.available && nvidiaSnapshot.gpus.length > 0),
        config: this.getServiceConfig(),
      });
      const nextResult = { success: true as const, ...result };
      // Cache only a successful, short-lived snapshot; installed-state changes clear it.
      this.backendListCache = {
        key: cacheKey,
        expiresAt: Date.now() + LLAMACPP_BACKEND_LIST_CACHE_TTL_MS,
        result: nextResult,
      };
      return nextResult;
    } catch (error) {
      return {
        success: false,
        backends: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getBackendDownloadSize(
    ref: LlamaCppBackendRef,
  ): Promise<{ success: boolean; sizeBytes?: number; error?: string }> {
    try {
      const sizeBytes = await resolveLlamaCppBackendDownloadSize({ ref });
      return sizeBytes === undefined
        ? { success: false, error: 'Backend download size is unavailable.' }
        : { success: true, sizeBytes };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getBackendSelection(): Promise<LlamaCppBackendRef | undefined> {
    return readCurrentBackendRef(getUserLlamaCppRuntimeRoot());
  }

  async setBackendSelection(
    ref: LlamaCppBackendRef,
    options: { signal?: AbortSignal } = {},
  ): Promise<LlamaCppRuntimeInstallResult> {
    this.clearBackendListCache();
    const runtimeRoot = getUserLlamaCppRuntimeRoot();
    const installedExecutablePath = getLlamaCppBackendExecutablePath(
      runtimeRoot,
      ref,
      process.platform,
    );
    const nvidiaSnapshot = process.platform === 'win32' ? await getNvidiaSmiSnapshot() : null;
    const hasNvidiaGpu = Boolean(nvidiaSnapshot?.available && nvidiaSnapshot.gpus.length > 0);
    const backendAlreadyInstalled = fs.existsSync(installedExecutablePath);
    if (!backendAlreadyInstalled) {
      this.emit('install-progress', {
        phase: 'starting',
        modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
        modelName: ref.versionBackend,
      } satisfies LlamaCppInstallProgress);
    }
    const compatibilityError = await getLlamaCppBackendCompatibilityError({
      runtimeRoot,
      ref,
      platform: process.platform,
      arch: process.arch,
      hasNvidiaGpu,
    });
    if (compatibilityError) {
      if (!backendAlreadyInstalled) {
        this.emit('install-progress', {
          phase: 'failed',
          modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
          modelName: ref.versionBackend,
          error: compatibilityError,
        } satisfies LlamaCppInstallProgress);
      }
      return {
        success: false,
        error: compatibilityError,
        plan: {
          kind: 'needs-manual',
          message: compatibilityError,
        },
      };
    }
    const result: LlamaCppRuntimeInstallResult = backendAlreadyInstalled
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
            signal: options.signal,
            onProgress: progress => {
              this.emit('install-progress', {
                ...progress,
                modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
                modelName: ref.versionBackend,
              } satisfies LlamaCppInstallProgress);
            },
          });
        })();
    if (result.success && result.executablePath) {
      if (backendRequiresDeviceValidation(ref)) {
        const deviceResult = await this.listRuntimeDevices(ref);
        if (!deviceResult.success) {
          if (!backendAlreadyInstalled) {
            this.emit('install-progress', {
              phase: 'failed',
              modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
              modelName: ref.versionBackend,
              error: deviceResult.error || 'Backend device validation failed.',
            } satisfies LlamaCppInstallProgress);
          }
          return {
            ...result,
            success: false,
            error: deviceResult.error || 'Backend device validation failed.',
          };
        }
        const validationError = validateBackendDevices(ref, deviceResult.devices);
        if (validationError) {
          if (!backendAlreadyInstalled) {
            this.emit('install-progress', {
              phase: 'failed',
              modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
              modelName: ref.versionBackend,
              error: validationError,
            } satisfies LlamaCppInstallProgress);
          }
          return {
            ...result,
            success: false,
            error: validationError,
          };
        }
      }
      const switchPreparation = await prepareLlamaCppBackendVersionSwitch({
        serviceStatus: this.status.status,
        listRunningModels: () =>
          (this as unknown as LlamaCppManagerDownstreamSurface).listRunningModels(),
        stop: () => (this as unknown as LlamaCppManagerDownstreamSurface).stop(),
      });
      if (switchPreparation.success === false) {
        if (!backendAlreadyInstalled) {
          this.emit('install-progress', {
            phase: 'failed',
            modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
            modelName: ref.versionBackend,
            error: switchPreparation.error,
          } satisfies LlamaCppInstallProgress);
        }
        return {
          ...result,
          success: false,
          error: switchPreparation.error,
          plan: { kind: 'needs-manual', message: switchPreparation.error },
        };
      }
      syncCurrentBackend(runtimeRoot, ref);
      const currentExecutablePath = getLlamaCppCurrentExecutablePath(runtimeRoot, process.platform);
      this.executablePath = currentExecutablePath;
      this.setStatus({
        status: 'installed',
        executablePath: currentExecutablePath,
        managedByApp: false,
      });
      if (switchPreparation.restartService) {
        const restartResult = await restartLlamaCppBackendVersionService({
          start: () => (this as unknown as LlamaCppManagerDownstreamSurface).start(),
        });
        if (restartResult.success === false) {
          if (!backendAlreadyInstalled) {
            this.emit('install-progress', {
              phase: 'failed',
              modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
              modelName: ref.versionBackend,
              error: restartResult.error,
            } satisfies LlamaCppInstallProgress);
          }
          return {
            ...result,
            success: false,
            error: restartResult.error,
            plan: { kind: 'needs-manual', message: restartResult.error },
          };
        }
      }
      if (!backendAlreadyInstalled) {
        this.emit('install-progress', {
          phase: 'done',
          modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
          modelName: ref.versionBackend,
          percent: 100,
        } satisfies LlamaCppInstallProgress);
      }
    } else {
      if (!backendAlreadyInstalled) {
        this.emit('install-progress', {
          phase: result.cancelled ? 'cancelled' : 'failed',
          modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
          modelName: ref.versionBackend,
          error: result.cancelled ? undefined : 'error' in result ? result.error : undefined,
        } satisfies LlamaCppInstallProgress);
      }
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
    this.clearBackendListCache();
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
      await (this as unknown as LlamaCppManagerDownstreamSurface).stop();
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
    this.clearBackendListCache();
    const runtimeRoot = getUserLlamaCppRuntimeRoot();
    try {
      const result = await uninstallLlamaCppBackend({
        runtimeRoot,
        status: this.status,
        stopCurrent: async () => {
          if (
            this.process &&
            this.executablePath &&
            isPathInside(this.executablePath, runtimeRoot)
          ) {
            await (this as unknown as LlamaCppManagerDownstreamSurface).stop();
          }
        },
      });
      if (this.executablePath && isPathInside(this.executablePath, runtimeRoot)) {
        this.executablePath = null;
      }
      const status = await (this as unknown as LlamaCppManagerDownstreamSurface).detect();
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
    this.clearBackendListCache();
    const runtimeRoot = getUserLlamaCppRuntimeRoot();
    try {
      const result = await uninstallLlamaCppBackend({
        runtimeRoot,
        ref,
        status: this.status,
        stopCurrent: async () => {
          if (
            this.process &&
            this.executablePath &&
            isPathInside(this.executablePath, runtimeRoot)
          ) {
            await (this as unknown as LlamaCppManagerDownstreamSurface).stop();
          }
        },
      });
      if (this.executablePath && isPathInside(this.executablePath, runtimeRoot)) {
        this.executablePath = null;
      }
      const status = await (this as unknown as LlamaCppManagerDownstreamSurface).detect();
      return { ...result, status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({
        status: 'error',
        executablePath: this.executablePath ?? undefined,
        managedByApp: Boolean(this.process),
        error: message,
      });
      return {
        success: false,
        deleted: false,
        runtimeRoot,
        backend: ref,
        status: this.status,
        error: message,
      };
    }
  }
}
