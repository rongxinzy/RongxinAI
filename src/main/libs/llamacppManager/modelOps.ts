// Model catalog, load/install, and metadata hydration (#1069).
import fs from 'fs';
import path from 'path';

import {
  applyAutomaticLlamaCppServiceDefaults,
  resolveLlamaCppLaunchContext,
} from '../../../shared/llamacpp';
import type {
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchResult,
  LlamaCppRunningModel,
  LlamaCppStatusSnapshot,
} from '../../../shared/llamacpp';
import { LlamaCppClient } from '../llamacppClient';
import { mergeLocalModels, scanLocalGgufModels } from '../llamacppModelCatalog';
import {
  installModelOnce,
  isModelDownloadNotFoundError,
  isSameInstallRequest,
  prefillInstallInputFromMarketplace,
  refreshInstallInputFromMarketplace,
  resolveManagedModelInstallDir,
} from '../llamacppModelInstallation';
import { retryLlamaCppReadRequest } from '../llamacppRequestRetry';
import { shouldEnableLlamaCppModelsAutoload } from '../llamacppServe';
import { getNvidiaSmiSnapshot } from '../nvidiaSmi';
import { shouldKeepLlamaCppServiceRunning } from '../llamacppProcessLifecycle';
import { resolveLlamaCppRuntimeMetadata } from '../llamacppRuntimePaths';
import type { ChildProcess } from 'child_process';
import { LlamaCppManagerLifecycleEvent, type LlamaCppModelsUnloadedForQuitEvent } from './types';
import {
  isGgufPath,
  modelLaunchOptionsToPreset,
  normalizePositiveInteger,
  removeEmptyParentDirs,
  resolveImportedModelTargetPath,
  upsertIniSection,
} from './fileUtils';
import { LlamaCppManagerService } from './serviceLifecycle';

const LLAMACPP_RUNNING_MODELS_DEFAULT_TIMEOUT_MS = 2_000;
const QUIT_RUNNING_MODELS_TIMEOUT_MS = 1500;
const QUIT_UNLOAD_MODEL_TIMEOUT_MS = 3000;
const LLAMACPP_LAST_LOADED_MODEL_KEY = 'llamacpp_last_loaded_model';

type RequestOptions = { signal?: AbortSignal };

export class LlamaCppManager extends LlamaCppManagerService {
  protected async restoreLastLoadedModelIfNeeded(): Promise<void> {
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
    if (
      runningModels.some(
        model => model.name === modelName || model.model === modelName || model.id === modelName,
      )
    ) {
      return;
    }
    try {
      console.log(`[LlamaCpp] restoring last loaded model on startup: ${modelName}`);
      await this.loadModel({ model: modelName });
    } catch (error) {
      console.warn(
        `[LlamaCpp] failed to restore last loaded model on startup: ${modelName}`,
        error,
      );
    }
  }

  protected getLastLoadedModel(): string | undefined {
    if (!this.storage) return undefined;
    const value = this.storage.get<unknown>(LLAMACPP_LAST_LOADED_MODEL_KEY);
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  protected persistLastLoadedModel(modelName: string): void {
    this.storage?.set(LLAMACPP_LAST_LOADED_MODEL_KEY, modelName.trim());
  }

  protected clearLastLoadedModel(modelName?: string): void {
    if (!this.storage) return;
    if (!modelName) {
      this.storage.delete(LLAMACPP_LAST_LOADED_MODEL_KEY);
      return;
    }
    if (this.getLastLoadedModel() === modelName.trim()) {
      this.storage.delete(LLAMACPP_LAST_LOADED_MODEL_KEY);
    }
  }

  clearPersistedLastLoadedModel(): void {
    this.clearLastLoadedModel();
  }

  async loadModel(
    input: LlamaCppModelLaunchInput,
    options: RequestOptions = {},
  ): Promise<LlamaCppModelLaunchResult> {
    const localModels = await this.listLocalModels().catch(() => [] as LlamaCppModel[]);
    const resolvedInput = await this.resolveModelLoadInput(input, localModels);
    const modelName = resolvedInput.model.trim();
    if (!modelName) throw new Error('Model name is required');
    await this.writeModelPreset(resolvedInput, localModels);
    const client = await this.client();
    await client.listModels({ signal: options.signal });
    const result = await client.loadModel(resolvedInput, options);
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

  async listRunningModels(
    timeoutMs = LLAMACPP_RUNNING_MODELS_DEFAULT_TIMEOUT_MS,
  ): Promise<LlamaCppRunningModel[]> {
    const client = await this.client();
    const runningModels = await retryLlamaCppReadRequest(() => client.runningModels(timeoutMs));
    if (this.needsThinkingToggleSupportRefresh(runningModels)) {
      this.refreshThinkingToggleSupport();
    }
    return this.hydrateRunningModels(runningModels);
  }

  async listRouterModels(timeoutMs = 30_000): Promise<LlamaCppModel[]> {
    const models = await (await this.client()).listModelsSnapshot(timeoutMs);
    return this.hydrateModelContextMetadata(models);
  }

  getRuntimeContextLength(modelName: string): number | undefined {
    return this.runtimeContextLengthByModel.get(modelName.trim());
  }

  async listLocalModels(): Promise<LlamaCppModel[]> {
    const scannedModels = scanLocalGgufModels(this.getModelsDir());
    this.cacheThinkingToggleSupport(scannedModels);
    let routerModels: LlamaCppModel[] = [];
    try {
      // Listing local models is a read-only UI refresh. Do not trigger the
      // router's reload endpoint or wait for the full 30s request timeout when
      // the optional backend is stopped or still starting.
      const client = await this.client();
      // Keep compatibility with lightweight test/integration clients that
      // predate the snapshot method; the production client always exposes it.
      routerModels =
        typeof client.listModelsSnapshot === 'function'
          ? await client.listModelsSnapshot(2_000)
          : await client.listModels();
      // Recovered: a later failure deserves its own explanation.
      this.routerListFailure = null;
    } catch (error) {
      // The router API is optional: a single-model server answers 404 on every
      // refresh. Report each distinct failure once with its stack, then keep the
      // documented GGUF fallback quiet instead of stacking a trace per poll.
      const signature = error instanceof Error ? error.message : String(error);
      if (this.routerListFailure === signature) {
        console.debug(`[LlamaCpp] router model list still unavailable: ${signature}`);
      } else {
        this.routerListFailure = signature;
        console.warn(
          `[LlamaCpp] router model list unavailable, using local GGUF scan: ${signature}`,
        );
      }
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

  async deleteModel(name: string): Promise<{
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
    if (shouldKeepLlamaCppServiceRunning(this.getServiceConfig())) {
      this.process?.unref();
      console.log('[LlamaCpp] keeping the local inference service running after app quit.');
      return this.status;
    }
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

    const unloadModelNames = Array.from(
      new Set(runningModels.map(model => (model.name || model.model || '').trim()).filter(Boolean)),
    );
    const logModelNames = Array.from(
      new Set(
        runningModels
          .flatMap(model => [model.name, model.model, model.id])
          .map(value => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (unloadModelNames.length === 0) return;

    console.log(`[LlamaCpp] unloading ${unloadModelNames.length} model(s) during app quit`);
    const results = await Promise.allSettled(
      unloadModelNames.map(async modelName => {
        await client.unloadModel(modelName, QUIT_UNLOAD_MODEL_TIMEOUT_MS);
      }),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(
          `[LlamaCpp] failed to unload model ${unloadModelNames[index]} during quit:`,
          result.reason,
        );
      }
    });
    if (logModelNames.length > 0) {
      this.emit(LlamaCppManagerLifecycleEvent.ModelsUnloadedForQuit, {
        modelNames: logModelNames,
      } satisfies LlamaCppModelsUnloadedForQuitEvent);
    }
  }

  protected async writeModelPreset(
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

  protected async resolveModelLoadInput(
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

  protected async resolveDefaultModelContextSize(): Promise<number | undefined> {
    const configuredContextSize = normalizePositiveInteger(this.getServiceConfig().ctxSize);
    if (configuredContextSize) {
      return configuredContextSize;
    }

    const nvidiaSnapshot =
      process.platform === 'win32' ? await getNvidiaSmiSnapshot().catch((): null => null) : null;
    const runtimeConfig = applyAutomaticLlamaCppServiceDefaults(this.getServiceConfig(), {
      nvidiaSnapshot,
    });
    return normalizePositiveInteger(runtimeConfig.ctxSize);
  }

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

  protected async refreshModelsAfterInstall(): Promise<void> {
    try {
      await new LlamaCppClient(this.getBaseUrl()).listModels();
    } catch {
      // The model list will be refreshed when the service is started.
    }
  }

  protected hydrateModelContextMetadata(models: LlamaCppModel[]): LlamaCppModel[] {
    return models.map(model => {
      const modelName = (model.name || model.model || model.id || '').trim();
      const runtimeContextLength =
        model.runtime_context_length ??
        (modelName ? this.runtimeContextLengthByModel.get(modelName) : undefined);
      if (modelName && runtimeContextLength) {
        this.runtimeContextLengthByModel.set(modelName, runtimeContextLength);
      }
      const trainedContextLength = model.trained_context_length ?? model.details?.context_length;
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
  }

  protected hydrateRunningModels(runningModels: LlamaCppRunningModel[]): LlamaCppRunningModel[] {
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

  protected cacheThinkingToggleSupport(models: LlamaCppModel[]): void {
    this.thinkingToggleSupportByModel.clear();
    models.forEach(model => {
      if (model.supportsThinkingToggle === undefined) return;
      this.getModelReferenceKeys(model).forEach(key => {
        this.thinkingToggleSupportByModel.set(key, model.supportsThinkingToggle === true);
      });
    });
  }

  protected refreshThinkingToggleSupport(): void {
    this.cacheThinkingToggleSupport(scanLocalGgufModels(this.getModelsDir()));
  }

  protected needsThinkingToggleSupportRefresh(runningModels: LlamaCppRunningModel[]): boolean {
    return runningModels.some(
      model =>
        model.supportsThinkingToggle === undefined &&
        this.getThinkingToggleSupport(model) === undefined,
    );
  }

  protected getThinkingToggleSupport(model: LlamaCppModel): boolean | undefined {
    return this.getModelReferenceKeys(model)
      .map(key => this.thinkingToggleSupportByModel.get(key))
      .find((supported): supported is boolean => supported !== undefined);
  }

  protected getModelReferenceKeys(model: LlamaCppModel): string[] {
    return [model.name, model.id, model.model, model.path]
      .filter((value): value is string => Boolean(value?.trim()))
      .map(value => value.trim().replace(/\\/g, '/'))
      .flatMap(value => [value, path.basename(value)])
      .map(value => value.toLowerCase());
  }
}
