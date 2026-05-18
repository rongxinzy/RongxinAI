import { execFile } from 'child_process';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import type {
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchResult,
  LlamaCppRunningModel,
  LlamaCppRuntimeInstallResult,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { LlamaCppClient } from './llamacppClient';
import {
  createLlamaCppRuntimeInstallPlan,
  ensureCMakeDependency,
  ensureLlamaCppRuntimeCurrent,
  executeLlamaCppRuntimeInstallPlan,
  findCMakePath,
  findNodePath,
  getProjectRoot,
  pathExists,
  resolveDefaultLlamaCppSourceDir,
  resolveLlamaCppRuntimeTargetId,
  syncLlamaCppRuntimeCurrent,
} from './llamacppRuntimeInstaller';

const execFileAsync = promisify(execFile);
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = '8080';
const QUIT_RUNNING_MODELS_TIMEOUT_MS = 1500;
const QUIT_UNLOAD_MODEL_TIMEOUT_MS = 3000;

type RequestOptions = { signal?: AbortSignal };

export class LlamaCppManager extends EventEmitter {
  private executablePath: string | null = null;
  private process: ChildProcessWithoutNullStreams | null = null;
  private status: LlamaCppStatusSnapshot = {
    status: 'unknown',
    checkedAt: new Date().toISOString(),
  };

  constructor(private readonly getServiceConfig: () => LlamaCppServiceConfig = () => ({})) {
    super();
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
    return this.getServiceConfig().modelsDir?.trim() || path.join(app.getPath('userData'), 'models', 'llamacpp');
  }

  getPresetPath(): string {
    return path.join(app.getPath('userData'), 'llamacpp', 'models-preset.ini');
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

    const executablePath = await findLlamaCppExecutable();
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
      this.executablePath = await findLlamaCppExecutable();
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

    this.setStatus({ status: 'starting', executablePath: this.executablePath, managedByApp: true });
    this.process = spawn(this.executablePath, buildLlamaServerArgs(this.getServiceConfig(), this.getModelsDir(), this.getPresetPath()), {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildLlamaCppServeEnv(process.env, this.getServiceConfig()),
    });

    this.process.stdout.on('data', (chunk) => console.debug(`[LlamaCpp] ${chunk.toString().trim()}`));
    this.process.stderr.on('data', (chunk) => console.warn(`[LlamaCpp] ${chunk.toString().trim()}`));
    this.process.on('exit', (code, signal) => {
      console.log(`[LlamaCpp] process exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`);
      this.process = null;
      if (this.status.status === 'running' || this.status.status === 'starting') {
        this.setStatus({ status: 'stopped', executablePath: this.executablePath ?? undefined, managedByApp: false });
      }
    });
    this.process.on('error', (error) => {
      console.warn('[LlamaCpp] process failed:', error);
      this.setStatus({ status: 'error', error: error.message, executablePath: this.executablePath ?? undefined, managedByApp: false });
    });

    await this.waitUntilHealthy(30_000);
    return this.status;
  }

  async installRuntime(): Promise<LlamaCppRuntimeInstallResult> {
    const projectRoot = getProjectRoot();
    const targetId = resolveLlamaCppRuntimeTargetId(process.platform, process.arch);
    if (targetId) {
      await ensureLlamaCppRuntimeCurrent(projectRoot, targetId);
    }

    const existingExecutablePath = await findLlamaCppExecutable();
    const sourceDir = resolveDefaultLlamaCppSourceDir();
    const scriptPath = path.join(projectRoot, 'scripts', 'run-build-llamacpp-runtime.cjs');
    const sourceExists = pathExists(sourceDir);
    const buildScriptExists = pathExists(scriptPath);
    let cmakePath = await findCMakePath();
    if (!existingExecutablePath && !app.isPackaged && sourceExists && buildScriptExists && !cmakePath) {
      this.setStatus({
        status: 'installing',
        executablePath: this.executablePath ?? undefined,
        managedByApp: false,
        error: undefined,
      });
      const cmakeResult = await ensureCMakeDependency();
      if (!cmakeResult.success) {
        const result: LlamaCppRuntimeInstallResult = {
          success: false,
          plan: {
            kind: 'needs-manual',
            message: cmakeResult.error ?? 'CMake is required to build llama.cpp runtime.',
          },
          error: cmakeResult.error,
        };
        this.setStatus({
          status: 'not-installed',
          executablePath: undefined,
          managedByApp: false,
          error: result.error,
        });
        return result;
      }
      cmakePath = cmakeResult.cmakePath ?? await findCMakePath();
    }
    const nodePath = await findNodePath();
    const plan = createLlamaCppRuntimeInstallPlan({
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      existingExecutablePath,
      projectRoot,
      sourceDir,
      sourceExists,
      buildScriptExists,
      cmakePath,
      nodePath,
    });
    this.setStatus({
      status: plan.kind === 'build' ? 'installing' : this.status.status,
      executablePath: existingExecutablePath ?? this.executablePath ?? undefined,
      managedByApp: false,
      error: undefined,
    });

    const result = await executeLlamaCppRuntimeInstallPlan(plan, {
      projectRoot,
      sourceDir,
      cmakePath,
      nodePath,
      findExecutable: findLlamaCppExecutable,
      syncRuntimeCurrent: (runtimeTargetId) => syncLlamaCppRuntimeCurrent(projectRoot, runtimeTargetId),
    });

    if (result.success && result.executablePath) {
      this.executablePath = result.executablePath;
      this.setStatus({
        status: 'installed',
        executablePath: result.executablePath,
        managedByApp: false,
      });
    } else {
      this.setStatus({
        status: 'not-installed',
        executablePath: existingExecutablePath ?? undefined,
        managedByApp: false,
        error: result.error,
      });
    }
    return result;
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

      this.setStatus({ status: 'stopped', executablePath: this.executablePath ?? undefined, managedByApp: false });
      return this.status;
    }

    const child = this.process;
    await new Promise<void>((resolve) => {
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

    this.setStatus({ status: 'stopped', executablePath: this.executablePath ?? undefined, managedByApp: false });
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
    return new LlamaCppClient(this.getBaseUrl());
  }

  async loadModel(input: LlamaCppModelLaunchInput): Promise<LlamaCppModelLaunchResult> {
    const modelName = input.model.trim();
    if (!modelName) throw new Error('Model name is required');
    await this.writeModelPreset({ ...input, model: modelName });
    const client = await this.client();
    return await client.loadModel({ ...input, model: modelName });
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

  async deleteModel(name: string): Promise<{ success: boolean; deleted?: boolean; reason?: 'not-local-file' | 'not-app-managed'; error?: string; removedModelName?: string }> {
    const modelName = name.trim();
    if (!modelName) throw new Error('Model name is required');
    const models = await this.listLocalModels();
    const model = models.find((item) => item.name === modelName || item.id === modelName);
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
    const resolved = await resolveModelScopeInstallRequest(input);
    const filePath = resolved.filePath;

    const url = resolved.downloadUrl || buildModelScopeFileUrl(modelId, filePath, input.revision);
    const safeModelDir = path.join(this.getModelsDir(), 'modelscope', ...modelId.split('/').map(sanitizePathSegment));
    fs.mkdirSync(safeModelDir, { recursive: true });
    const targetPath = resolveModelScopeTargetPath(safeModelDir, filePath);
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
      onProgress?.({ phase: 'done', modelId, modelName: input.displayName ?? modelId, percent: 100, targetPath });
      await this.refreshModelsAfterInstall();
      return {
        name: resolveInstalledModelName(this.getModelsDir(), targetPath),
        id: resolveInstalledModelName(this.getModelsDir(), targetPath),
        model: resolveInstalledModelName(this.getModelsDir(), targetPath),
        path: targetPath,
        size: fs.statSync(targetPath).size,
        source: 'modelscope',
        status: 'unloaded',
        details: { format: 'gguf' },
      };
    }

    onProgress?.({ phase: 'downloading', modelId, modelName: input.displayName ?? modelId, targetPath });
    await downloadFile(url, targetPath, (completed, total) => {
      onProgress?.({
        phase: 'downloading-progress',
        modelId,
        modelName: input.displayName ?? modelId,
        completed,
        total,
        percent: total ? Math.round((completed / total) * 100) : undefined,
        targetPath,
      });
    }, options.signal);

    if (input.mmprojFilePath?.trim()) {
      const mmprojFilePath = input.mmprojFilePath.trim();
      const mmprojUrl = buildModelScopeFileUrl(modelId, mmprojFilePath, input.revision);
      const mmprojTargetPath = resolveModelScopeTargetPath(safeModelDir, mmprojFilePath);
      onProgress?.({ phase: 'downloading', modelId, modelName: input.displayName ?? modelId, targetPath: mmprojTargetPath });
      await downloadFile(mmprojUrl, mmprojTargetPath, (completed, total) => {
        onProgress?.({
          phase: 'downloading-progress',
          modelId,
          modelName: input.displayName ?? modelId,
          completed,
          total,
          percent: total ? Math.round((completed / total) * 100) : undefined,
          targetPath: mmprojTargetPath,
        });
      }, options.signal);
    }

    onProgress?.({ phase: 'done', modelId, modelName: input.displayName ?? modelId, percent: 100, targetPath });
    await this.refreshModelsAfterInstall();

    return {
      name: resolveInstalledModelName(this.getModelsDir(), targetPath),
      id: resolveInstalledModelName(this.getModelsDir(), targetPath),
      model: resolveInstalledModelName(this.getModelsDir(), targetPath),
      path: targetPath,
      size: fs.statSync(targetPath).size,
      source: 'modelscope',
      status: 'unloaded',
      details: { format: 'gguf' },
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
      runningModels = await client.runningModels(QUIT_RUNNING_MODELS_TIMEOUT_MS);
    } catch (error) {
      console.debug('[LlamaCpp] skipped model unload during quit because running models could not be listed:', error);
      return;
    }

    const modelNames = Array.from(new Set(
      runningModels
        .map((model) => (model.name || model.model || '').trim())
        .filter(Boolean),
    ));
    if (modelNames.length === 0) return;

    console.log(`[LlamaCpp] unloading ${modelNames.length} model(s) during app quit`);
    const results = await Promise.allSettled(
      modelNames.map(async (modelName) => {
        await client.unloadModel(modelName, QUIT_UNLOAD_MODEL_TIMEOUT_MS);
      }),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`[LlamaCpp] failed to unload model ${modelNames[index]} during quit:`, result.reason);
      }
    });
  }

  private async writeModelPreset(input: LlamaCppModelLaunchInput): Promise<void> {
    const models = await this.listLocalModels().catch(() => [] as LlamaCppModel[]);
    const model = models.find((item) => item.name === input.model || item.id === input.model);
    const modelPath = input.modelPath || model?.path;
    const existing = fs.existsSync(this.getPresetPath()) ? fs.readFileSync(this.getPresetPath(), 'utf-8') : 'version = 1\n\n';
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
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    this.setStatus({
      status: 'error',
      executablePath: this.executablePath ?? undefined,
      error: 'llama.cpp did not become ready before timeout',
      managedByApp: Boolean(this.process),
    });
  }

  private setStatus(patch: Omit<Partial<LlamaCppStatusSnapshot>, 'checkedAt'> & { status: LlamaCppStatusSnapshot['status'] }): void {
    this.status = {
      ...this.status,
      ...patch,
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
}

export function buildLlamaServerArgs(config: LlamaCppServiceConfig, modelsDir: string, presetPath: string): string[] {
  const args = [
    '--host', config.host?.trim() || DEFAULT_HOST,
    '--port', config.port?.trim() || DEFAULT_PORT,
    '--models-dir', modelsDir,
    '--models-preset', presetPath,
    '--props',
    '--slots',
    '--no-ui',
  ];
  appendArg(args, '--models-max', config.modelsMax);
  if (typeof config.modelsAutoload === 'boolean') {
    args.push(config.modelsAutoload ? '--models-autoload' : '--no-models-autoload');
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

function appendArg(args: string[], name: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  args.push(name, trimmed);
}

function buildLlamaCppServeEnv(baseEnv: NodeJS.ProcessEnv, _config: LlamaCppServiceConfig): NodeJS.ProcessEnv {
  return { ...baseEnv };
}

export async function findLlamaCppExecutable(): Promise<string | null> {
  const envPath = process.env.LLAMACPP_BIN?.trim();
  if (envPath && fs.existsSync(envPath)) return envPath;

  for (const candidate of getKnownLlamaCppExecutablePaths()) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const command = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(command, ['llama-server'], { timeout: 1000 });
    const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

function getKnownLlamaCppExecutablePaths(): string[] {
  const extension = process.platform === 'win32' ? '.exe' : '';
  const resourceRoot = process.resourcesPath || path.join(__dirname, '..', '..');
  return [
    path.join(resourceRoot, 'llamacpp', `llama-server${extension}`),
    path.join(resourceRoot, 'llamacpp', 'bin', `llama-server${extension}`),
    path.join(__dirname, '..', '..', 'vendor', 'llamacpp-runtime', 'current', `llama-server${extension}`),
    path.join(__dirname, '..', '..', 'vendor', 'llamacpp-runtime', 'current', 'bin', `llama-server${extension}`),
    path.join(process.cwd(), 'vendor', 'llamacpp-runtime', 'current', `llama-server${extension}`),
    path.join(process.cwd(), 'vendor', 'llamacpp-runtime', 'current', 'bin', `llama-server${extension}`),
    '/opt/homebrew/bin/llama-server',
    '/usr/local/bin/llama-server',
    '/usr/bin/llama-server',
  ];
}

export function modelLaunchOptionsToPreset(options: NonNullable<LlamaCppModelLaunchInput['options']>): Record<string, string | number | boolean> {
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
    ...(options.reasoningFormat && options.reasoningFormat !== 'auto' ? { 'reasoning-format': options.reasoningFormat } : {}),
    ...(options.chatTemplate ? { 'chat-template': options.chatTemplate } : {}),
  };
}

function upsertIniSection(source: string, section: string, values: Record<string, string | number | boolean>): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${section}]`);
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
  return [
    ...lines.slice(0, start),
    ...rendered,
    ...lines.slice(end),
  ].join('\n').trimEnd() + '\n';
}

export async function resolveModelScopeInstallRequest(input: LlamaCppInstallModelInput): Promise<{
  filePath: string;
  downloadUrl?: string;
}> {
  const downloadUrl = input.downloadUrl?.trim();
  if (downloadUrl) {
    const filePath = input.filePath?.trim() || new URL(downloadUrl).pathname.split('/').filter(Boolean).pop() || 'model.gguf';
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
    return { filePath: explicitFilePath };
  }

  const modelId = input.modelId.trim();
  const files = await fetchModelScopeRepoFiles(modelId, input.revision);
  const ggufFile = chooseModelScopeInstallFile(files);
  if (!ggufFile) {
    throw new Error(`No GGUF files were found in ModelScope model ${modelId}. Use a GGUF repository or specify owner/repo::file.gguf.`);
  }
  return { filePath: ggufFile };
}

export function buildModelScopeFileUrl(modelId: string, filePath: string, revision = 'master'): string {
  const [owner, repo] = modelId.split('/');
  if (!owner || !repo) throw new Error('ModelScope model ID must be in owner/repo format.');
  const params = new URLSearchParams({
    FilePath: filePath,
    Revision: revision,
  });
  return `https://www.modelscope.cn/api/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/repo?${params.toString()}`;
}

async function fetchModelScopeRepoFiles(modelId: string, revision = 'master'): Promise<string[]> {
  const [owner, repo] = modelId.split('/');
  if (!owner || !repo) throw new Error('ModelScope model ID must be in owner/repo format.');
  const params = new URLSearchParams({
    Revision: revision,
    Recursive: 'true',
  });
  const response = await fetch(`https://www.modelscope.cn/api/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/repo/files?${params.toString()}`, {
    headers: { 'User-Agent': 'RongxinAI/modelscope-gguf-installer' },
  });
  if (!response.ok) {
    throw new Error(`Failed to read ModelScope model files: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return extractModelScopeFilePaths(payload);
}

export function extractModelScopeFilePaths(payload: unknown): string[] {
  const records = extractRecords(payload);
  const paths = records
    .map((record) => readRecordString(record.Path)
      || readRecordString(record.path)
      || readRecordString(record.FilePath)
      || readRecordString(record.filePath)
      || readRecordString(record.Name)
      || readRecordString(record.name))
    .filter((value): value is string => Boolean(value));
  return [...new Set(paths)];
}

export function chooseModelScopeInstallFile(files: string[]): string | undefined {
  const ggufFiles = files.filter((file) => isGgufPath(file) && !/^mmproj/i.test(path.basename(file)));
  if (ggufFiles.length === 0) return undefined;
  const preferred = ['q4_k_m', 'q5_k_m', 'q4_0', 'q8_0'];
  for (const quantization of preferred) {
    const match = ggufFiles.find((file) => path.basename(file).toLowerCase().includes(quantization));
    if (match) return match;
  }
  return ggufFiles.sort((a, b) => a.localeCompare(b))[0];
}

export function scanLocalGgufModels(modelsDir: string): LlamaCppModel[] {
  const root = path.resolve(modelsDir);
  if (!fs.existsSync(root)) return [];
  const files = walkGgufFiles(root).filter((filePath) => !/^mmproj/i.test(path.basename(filePath)));
  const nameCounts = new Map<string, number>();
  return files.map((filePath) => {
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
      details: { format: 'gguf', quantization_level: inferQuantizationFromFilename(path.basename(filePath)) },
    };
  });
}

export function mergeLocalModels(routerModels: LlamaCppModel[], scannedModels: LlamaCppModel[], modelsDir?: string): LlamaCppModel[] {
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

function isPathInside(target: string, root: string): boolean {
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
  return fileName.toUpperCase().match(/\b(Q[2-8](?:_[A-Z0-9]+){0,3}|F16|F32|BF16|IQ[1-4]_[A-Z0-9_]+)\b/)?.[1];
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
      item.forEach((child) => stack.push(child));
      continue;
    }
    if (!isRecord(item)) continue;
    Object.values(item).forEach((child) => {
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

function resolveModelScopeTargetPath(modelDir: string, filePath: string): string {
  const segments = filePath
    .split(/[\\/]+/)
    .map(sanitizePathSegment)
    .filter(Boolean);
  const fileName = segments.pop() || 'model.gguf';
  const normalizedFileName = fileName.toLowerCase().endsWith('.gguf') ? fileName : `${fileName}.gguf`;
  const targetDir = path.join(modelDir, ...segments);
  fs.mkdirSync(targetDir, { recursive: true });
  return path.join(targetDir, normalizedFileName);
}

async function downloadFile(
  url: string,
  targetPath: string,
  onProgress: (completed: number, total?: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const tempPath = `${targetPath}.download`;
  const resumeFrom = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
  const response = await fetch(url, {
    signal,
    ...(resumeFrom > 0 ? { headers: { Range: `bytes=${resumeFrom}-` } } : {}),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed: HTTP ${response.status}`);
  }
  const resumed = resumeFrom > 0 && response.status === 206;
  const totalHeader = response.headers.get('content-length');
  const contentRangeTotal = parseContentRangeTotal(response.headers.get('content-range'));
  const total = contentRangeTotal ?? (totalHeader ? Number(totalHeader) + (resumed ? resumeFrom : 0) : undefined);
  const file = fs.createWriteStream(tempPath, { flags: resumed ? 'a' : 'w' });
  const reader = response.body.getReader();
  let completed = resumed ? resumeFrom : 0;
  let completedSuccessfully = false;
  try {
    if (completed > 0) onProgress(completed, Number.isFinite(total) ? total : undefined);
    while (true) {
      if (signal?.aborted) throw new Error('Install cancelled');
      const { value, done } = await reader.read();
      if (done) break;
      completed += value.byteLength;
      if (!file.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => file.once('drain', resolve));
      }
      onProgress(completed, Number.isFinite(total) ? total : undefined);
    }
    completedSuccessfully = true;
  } finally {
    await new Promise<void>((resolve) => file.end(resolve));
  }
  if (completedSuccessfully) fs.renameSync(tempPath, targetPath);
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
