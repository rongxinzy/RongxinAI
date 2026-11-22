import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import {
  isLikelyCudaDriverMismatchError,
  LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID,
  type LlamaCppBackendListResult,
  type LlamaCppBackendRef,
  type LlamaCppInstallModelInput,
  type LlamaCppInstallProgress,
  type LlamaCppModel,
  type LlamaCppRuntimeCapabilities,
  type LlamaCppRuntimeImportResult,
  type LlamaCppRuntimeInstallResult,
  type LlamaCppRuntimeListDevicesResult,
  type LlamaCppRuntimeUninstallResult,
  type LlamaCppServiceConfig,
  type LlamaCppStatusSnapshot,
} from '../../../shared/llamacpp';
import { t } from '../../i18n';
import { scanLocalModelsAsync } from '../../workbenchTask/artifactWorkerPool';
import {
  isLocalInferenceFeatureEnabled,
  usesBundledLlamaCppRuntime,
} from '../inferenceEditionPolicy';
import {
  fetchLlamaCppBackendManifest,
  getLlamaCppBackendCompatibilityError,
  getLlamaCppBackendExecutablePath,
  importLlamaCppBackendPath,
  installLlamaCppBackend,
  listLlamaCppBackends,
  recommendLlamaCppBackend,
  recommendLlamaCppCpuBackend,
  uninstallLlamaCppBackend,
} from '../llamacppBackendManager';
import {
  backendRequiresDeviceValidation,
  validateBackendDevices,
} from '../llamacppBackendValidation';
import { readBundledLlamaCppRuntimeManifest } from '../llamacppBundledRuntime';
import {
  resolveBundledEditionRuntime,
  type ResolvedBundledRuntime,
} from '../llamacppBundledRuntimeSelection';
import {
  primaryGpuSupportsCudaEdition,
  resolveCudaEditionGpuMessage,
  shouldEnforceCudaEditionGpuPolicy,
} from '../llamacppCudaEditionPolicy';
import {
  installModelOnce,
  isModelDownloadNotFoundError,
  isSameInstallRequest,
  prefillInstallInputFromMarketplace,
  refreshInstallInputFromMarketplace,
  resolveManagedModelInstallDir,
} from '../llamacppModelInstallation';
import { resolveLlamaCppModelsDir } from '../llamacppModelLibraryPath';
import { getLlamaCppNvidiaSnapshot, hasAvailableNvidiaGpu } from '../llamacppNvidiaEnvironment';
import { listLlamaCppRuntimeDevices } from '../llamacppRuntimeDeviceProbe';
import {
  findExternalLlamaCppExecutable,
  findLlamaCppExecutable,
  getUserLlamaCppRuntimeRoot,
  resolveLlamaCppRuntimeMetadata,
} from '../llamacppRuntimePaths';
import {
  buildLlamaCppServiceConfigFieldSupport,
  isGpuLikeRuntimeDevice,
  listLlamaCppRuntimeHelpFlags,
} from '../llamacppServe';
import type { MarketplaceService } from '../marketplaceService';
import { isPathInside } from '../../pathContainment';
import { isGgufPath, removeEmptyParentDirs, resolveImportedModelTargetPath } from './fileUtils';

const LLAMACPP_RUNTIME_PROGRESS_KEY = LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID;
const LLAMACPP_BACKEND_LIST_CACHE_TTL_MS = 60_000;

type RequestOptions = { signal?: AbortSignal };
type LlamaCppRuntimeInstallOptions = RequestOptions & {
  activate: (ref: LlamaCppBackendRef) => Promise<void>;
};

type LlamaCppBackendListCacheEntry = {
  key: string;
  expiresAt: number;
  result: LlamaCppBackendListResult;
};

export class LlamaCppManager extends EventEmitter {
  private backendListCache: LlamaCppBackendListCacheEntry | null = null;

  constructor(
    private readonly getServiceConfig: () => LlamaCppServiceConfig,
    private readonly marketplaceService: Pick<MarketplaceService, 'resolveModel'>,
  ) {
    super();
  }

  getModelsDir(): string {
    return resolveLlamaCppModelsDir(this.getServiceConfig());
  }

  initializeModelsDir(): string {
    const modelsDir = this.getModelsDir();
    fs.mkdirSync(modelsDir, { recursive: true });
    return modelsDir;
  }

  private getBackendListCacheKey(): string {
    const config = this.getServiceConfig();
    return [
      process.platform,
      process.arch,
      config.runtimeVersion?.trim() ?? '',
      config.runtimeBackend ?? '',
    ].join(':');
  }

  private clearBackendListCache(): void {
    this.backendListCache = null;
  }

  async installRuntime(
    options: LlamaCppRuntimeInstallOptions,
  ): Promise<LlamaCppRuntimeInstallResult> {
    if (!isLocalInferenceFeatureEnabled()) {
      const error = 'Local inference is not included in this edition.';
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
      this.emit('install-progress', {
        phase: 'done',
        modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
        modelName: 'llama.cpp runtime',
        percent: 100,
      } satisfies LlamaCppInstallProgress);
      return {
        success: true,
        executablePath: externalExecutablePath,
        plan: { kind: 'ready', executablePath: externalExecutablePath },
      };
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
      return {
        success: false,
        plan: { kind: 'needs-manual', message: error },
        error,
      };
    }
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
      try {
        await this.activateInstalledBackend(ref, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emit('install-progress', {
          phase: options.signal?.aborted ? 'cancelled' : 'failed',
          modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
          modelName: ref.versionBackend,
          error: options.signal?.aborted ? undefined : message,
        } satisfies LlamaCppInstallProgress);
        return {
          success: false,
          cancelled: options.signal?.aborted || undefined,
          plan: { kind: 'needs-manual', message },
          error: message,
        };
      }
      this.emit('install-progress', {
        phase: 'done',
        modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
        modelName: ref.versionBackend,
        percent: 100,
      } satisfies LlamaCppInstallProgress);
    } else {
      this.emit('install-progress', {
        phase: result.cancelled ? 'cancelled' : 'failed',
        modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
        modelName: ref.versionBackend,
        error: result.cancelled ? undefined : 'error' in result ? result.error : undefined,
      } satisfies LlamaCppInstallProgress);
    }
    return installWarning && result.success ? { ...result, warning: installWarning } : result;
  }

  private async activateInstalledBackend(
    ref: LlamaCppBackendRef,
    options: LlamaCppRuntimeInstallOptions,
  ): Promise<void> {
    options.signal?.throwIfAborted();
    await options.activate(ref);
  }

  private async installBundledRuntime(
    options: LlamaCppRuntimeInstallOptions,
  ): Promise<LlamaCppRuntimeInstallResult> {
    const nvidiaSnapshot = await getLlamaCppNvidiaSnapshot();
    const manifest = readBundledLlamaCppRuntimeManifest();
    if (!manifest) {
      const error = 'Bundled llama.cpp runtime manifest is missing from this installation.';
      return { success: false, plan: { kind: 'needs-manual', message: error }, error };
    }

    let preferCpuFallback = false;
    let installWarning: string | undefined;
    if (shouldEnforceCudaEditionGpuPolicy() && !primaryGpuSupportsCudaEdition(nvidiaSnapshot)) {
      installWarning = resolveCudaEditionGpuMessage(nvidiaSnapshot);
      preferCpuFallback = Boolean(manifest.cpuFallbackExecutable);
      if (!preferCpuFallback) {
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
      options.signal?.throwIfAborted();
      await options.activate(resolved.backend);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, plan: { kind: 'needs-manual', message }, error: message };
    }

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
    const executablePath = ref
      ? getLlamaCppBackendExecutablePath(getUserLlamaCppRuntimeRoot(), ref, process.platform)
      : await findLlamaCppExecutable(this.getServiceConfig());
    const result = await this.probeRuntimeDevices(executablePath);
    return ref ? { ...result, backend: ref } : result;
  }

  private async probeRuntimeDevices(
    executablePath: string | null,
  ): Promise<LlamaCppRuntimeListDevicesResult> {
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
        devices: [],
        error: `llama.cpp executable does not exist: ${executablePath}`,
      };
    }
    return listLlamaCppRuntimeDevices({
      executablePath,
      platform: process.platform,
      baseEnv: process.env,
    });
  }

  async getRuntimeCapabilities(): Promise<LlamaCppRuntimeCapabilities> {
    const executablePath = await findLlamaCppExecutable(this.getServiceConfig());
    if (!executablePath) {
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
        executablePath,
        platform: process.platform,
        baseEnv: process.env,
      }),
      this.probeRuntimeDevices(executablePath),
    ]);

    const metadata = resolveLlamaCppRuntimeMetadata(executablePath);
    const devices = devicesResult.success ? devicesResult.devices : [];
    const backendKinds = Array.from(new Set(devices.map(device => device.backend).filter(Boolean)));
    const gpuDeviceCount = devices.filter(device => isGpuLikeRuntimeDevice(device)).length;
    return {
      success: helpFlagsResult.success || devicesResult.success,
      executablePath,
      version: metadata.runtimeVersion,
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
        runtimeBackend: metadata.runtimeBackend,
      }),
      ...(helpFlagsResult.success
        ? {}
        : { error: helpFlagsResult.error ?? devicesResult.error ?? 'Failed to probe runtime.' }),
    };
  }

  private async readInstallationStatus(): Promise<LlamaCppStatusSnapshot> {
    const executablePath = (await findLlamaCppExecutable(this.getServiceConfig())) ?? undefined;
    return {
      status: executablePath ? 'installed' : 'not-installed',
      executablePath,
      ...resolveLlamaCppRuntimeMetadata(executablePath),
      checkedAt: new Date().toISOString(),
    };
  }

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

  async importRuntime(
    sourcePath: string,
    beforeReplace: () => Promise<void>,
  ): Promise<LlamaCppRuntimeImportResult> {
    this.clearBackendListCache();
    try {
      const nvidiaSnapshot = await getLlamaCppNvidiaSnapshot();
      const result = await importLlamaCppBackendPath({
        runtimeRoot: getUserLlamaCppRuntimeRoot(),
        sourcePath,
        beforeReplace,
        platform: process.platform,
        arch: process.arch,
        hasNvidiaGpu: hasAvailableNvidiaGpu(nvidiaSnapshot),
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  async uninstallRuntime(ref?: LlamaCppBackendRef): Promise<LlamaCppRuntimeUninstallResult> {
    this.clearBackendListCache();
    const runtimeRoot = getUserLlamaCppRuntimeRoot();
    try {
      const result = await uninstallLlamaCppBackend({ runtimeRoot, ref });
      return { ...result, status: await this.readInstallationStatus() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        deleted: false,
        runtimeRoot,
        backend: ref,
        status: { status: 'error', error: message, checkedAt: new Date().toISOString() },
        error: message,
      };
    }
  }

  async setBackendSelection(
    ref: LlamaCppBackendRef,
    options: LlamaCppRuntimeInstallOptions,
  ): Promise<LlamaCppRuntimeInstallResult> {
    this.clearBackendListCache();
    const runtimeRoot = getUserLlamaCppRuntimeRoot();
    const installedExecutablePath = getLlamaCppBackendExecutablePath(
      runtimeRoot,
      ref,
      process.platform,
    );
    const nvidiaSnapshot = await getLlamaCppNvidiaSnapshot();
    const hasNvidiaGpu = hasAvailableNvidiaGpu(nvidiaSnapshot);
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
      try {
        await this.activateInstalledBackend(ref, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!backendAlreadyInstalled) {
          this.emit('install-progress', {
            phase: options.signal?.aborted ? 'cancelled' : 'failed',
            modelId: LLAMACPP_RUNTIME_PROGRESS_KEY,
            modelName: ref.versionBackend,
            error: options.signal?.aborted ? undefined : message,
          } satisfies LlamaCppInstallProgress);
        }
        return {
          success: false,
          cancelled: options.signal?.aborted || undefined,
          error: message,
          plan: { kind: 'needs-manual', message },
        };
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

  async listLocalModels(signal?: AbortSignal): Promise<LlamaCppModel[]> {
    const models = await scanLocalModelsAsync(this.getModelsDir(), signal);
    return models.sort((first, second) => first.name.localeCompare(second.name));
  }

  async deleteModel(
    name: string,
    deleteFile: (modelName: string, modelPath: string) => Promise<void>,
  ): Promise<{
    success: boolean;
    deleted?: boolean;
    reason?: 'not-local-file' | 'not-app-managed';
    error?: string;
    removedModelName?: string;
  }> {
    const modelName = name.trim();
    if (!modelName) throw new Error('Model name is required');
    const root = path.resolve(this.getModelsDir());
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
    const target = path.resolve(modelPath);
    const parent = path.dirname(target);
    if (
      !isPathInside(parent, root) ||
      !isPathInside(await fs.promises.realpath(parent), await fs.promises.realpath(root))
    ) {
      return {
        success: false,
        deleted: false,
        reason: 'not-app-managed',
        error: 'Only models in the app-managed models directory can be deleted.',
      };
    }
    await deleteFile(modelName, target);
    await removeEmptyParentDirs(parent, root);
    return { success: true, deleted: true, removedModelName: modelName };
  }

  async installModel(
    input: LlamaCppInstallModelInput,
    onProgress?: (progress: LlamaCppInstallProgress) => void,
    options: RequestOptions = {},
  ): Promise<LlamaCppModel> {
    const modelId = input.modelId.trim();
    if (!modelId) throw new Error('Model ID is required');
    const modelsDir = this.getModelsDir();
    const safeModelDir = resolveManagedModelInstallDir(modelsDir, modelId);
    let request = await prefillInstallInputFromMarketplace(input, this.marketplaceService);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await installModelOnce({
          request,
          safeModelDir,
          modelsDir,
          onProgress,
          options,
        });
      } catch (error) {
        lastError = error;
        if (attempt > 0 || !isModelDownloadNotFoundError(error)) {
          throw error;
        }
        const refreshed = await refreshInstallInputFromMarketplace(
          request,
          this.marketplaceService,
        );
        if (!refreshed || isSameInstallRequest(request, refreshed)) {
          throw error;
        }
        request = refreshed;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async importModelFiles(filePaths: string[]): Promise<LlamaCppModel[]> {
    const sources = filePaths.map(filePath => path.resolve(filePath)).filter(isGgufPath);
    if (sources.length === 0) return [];

    const modelsDir = path.resolve(this.getModelsDir());
    const importDir = path.join(modelsDir, 'imported');
    await fs.promises.mkdir(importDir, { recursive: true });
    const stagingDir = await fs.promises.mkdtemp(path.join(importDir, '.gguf-import-'));
    const importedPaths = new Set<string>();
    try {
      for (const [index, source] of sources.entries()) {
        await fs.promises.copyFile(source, path.join(stagingDir, String(index)));
      }

      // Pick the name and publish in one turn so concurrent imports cannot choose the same path.
      for (const [index, source] of sources.entries()) {
        const targetPath = resolveImportedModelTargetPath(importDir, source);
        fs.renameSync(path.join(stagingDir, String(index)), targetPath);
        importedPaths.add(targetPath);
      }
    } catch (error) {
      for (const targetPath of importedPaths) {
        try {
          fs.rmSync(targetPath, { force: true });
          importedPaths.delete(targetPath);
        } catch (rollbackError) {
          console.warn('[LlamaCpp] failed to roll back a model import:', targetPath, rollbackError);
        }
      }
      throw error;
    } finally {
      await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(error => {
        console.warn('[LlamaCpp] failed to remove staged model imports:', error);
      });
    }

    return (await scanLocalModelsAsync(modelsDir)).filter(model =>
      Boolean(model.path && importedPaths.has(model.path)),
    );
  }
}
