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
} from '../../../shared/llamacpp';
import type { LlamaCppBackendRef } from '../../../shared/llamacpp';
import {
  applyAutomaticLlamaCppServiceDefaults,
  isLikelyCudaDriverMismatchError,
  LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID,
  resolveLlamaCppLaunchContext,
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
  recommendLlamaCppCpuBackend,
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
import {
  readBundledLlamaCppRuntimeManifest,
  resolveBundledLlamaCppExecutablePath,
} from '../llamacppBundledRuntime';
import {
  isVulkanBackendStartupFailure,
  resolveBundledEditionRuntime,
  type ResolvedBundledRuntime,
} from '../llamacppBundledRuntimeSelection';
import {
  primaryGpuSupportsCudaEdition,
  resolveCudaEditionGpuMessage,
  shouldEnforceCudaEditionGpuPolicy,
} from '../llamacppCudaEditionPolicy';
import {
  isLocalInferenceFeatureEnabled,
  usesBundledLlamaCppRuntime,
} from '../inferenceEditionPolicy';
import { LlamaCppClient } from '../llamacppClient';
import { isPathInside, mergeLocalModels, scanLocalGgufModels } from '../llamacppModelCatalog';
import {
  installModelOnce,
  isModelDownloadNotFoundError,
  isSameInstallRequest,
  prefillInstallInputFromMarketplace,
  refreshInstallInputFromMarketplace,
  resolveManagedModelInstallDir,
} from '../llamacppModelInstallation';
import { getDefaultLlamaCppModelsDir } from '../llamacppModelLibraryPath';
import {
  createLlamaCppServerSpawnOptions,
  shouldKeepLlamaCppServiceRunning,
} from '../llamacppProcessLifecycle';
import { retryLlamaCppReadRequest } from '../llamacppRequestRetry';
import {
  createLlamaCppRuntimeInstallPlan,
  executeLlamaCppRuntimeInstallPlan,
  resolveLlamaCppExecutableName,
} from '../llamacppRuntimeInstaller';
import {
  findExternalLlamaCppExecutable,
  findLlamaCppExecutable,
  getUserLlamaCppRuntimeRoot,
  resolveLlamaCppRuntimeMetadata,
} from '../llamacppRuntimePaths';
import {
  buildLlamaCppServeEnv,
  buildLlamaCppServiceConfigFieldSupport,
  buildLlamaServerArgs,
  filterLlamaCppServiceConfigByRuntimeCapabilities,
  isGpuLikeRuntimeDevice,
  listLlamaCppRuntimeHelpFlags,
  resolveLlamaCppDeviceSelection,
  shouldEnableLlamaCppModelsAutoload,
} from '../llamacppServe';
import { listLlamaCppRuntimeDevices } from '../llamacppRuntimeDeviceProbe';
import { MarketplaceService } from '../marketplaceService';
import { getLlamaCppNvidiaSnapshot, hasAvailableNvidiaGpu } from '../llamacppNvidiaEnvironment';
import { t } from '../../i18n';

import { LlamaCppManagerCore } from './core';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = '8080';
const DEFAULT_CONNECTION_AND_LOAD_TIMEOUT_MS = 120_000;
const LLAMACPP_RUNNING_MODELS_DEFAULT_TIMEOUT_MS = 2_000;
const QUIT_RUNNING_MODELS_TIMEOUT_MS = 1500;
const QUIT_UNLOAD_MODEL_TIMEOUT_MS = 3000;
const LLAMACPP_RUNTIME_PROGRESS_KEY = LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID;
const LLAMACPP_LAST_LOADED_MODEL_KEY = 'llamacpp_last_loaded_model';
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

export class LlamaCppManagerBackendOps extends LlamaCppManagerCore {
  async listBackends(): Promise<LlamaCppBackendListResult> {
    const cacheKey = this.getBackendListCacheKey();
    const cached = this.backendListCache;
    if (cached && cached.key === cacheKey && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    try {
      const nvidiaSnapshot = await getLlamaCppNvidiaSnapshot();
      const result = await listLlamaCppBackends({
        runtimeRoot: getUserLlamaCppRuntimeRoot(),
        platform: process.platform,
        arch: process.arch,
        hasNvidiaGpu: hasAvailableNvidiaGpu(nvidiaSnapshot),
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
      await this.stop();
      const nvidiaSnapshot = await getLlamaCppNvidiaSnapshot();
      const result = await importLlamaCppBackendPath({
        runtimeRoot: getUserLlamaCppRuntimeRoot(),
        sourcePath: sourceDir,
        platform: process.platform,
        arch: process.arch,
        hasNvidiaGpu: hasAvailableNvidiaGpu(nvidiaSnapshot),
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
}
