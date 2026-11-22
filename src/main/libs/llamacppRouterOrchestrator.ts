import { type ChildProcess, spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { addAbortListener } from 'node:events';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

import type {
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { LlamaCppClient } from './llamacppClient';
import { LlamaCppGatewayCredentialVault } from './llamacppGatewayCredentialVault';
import type { LlamaCppModelDaemonStatus } from './llamacppModelDaemonProtocol';
import type { LlamaCppModelOrchestrator } from './llamacppModelOrchestrator';
import {
  createLlamaCppModelGateway,
  resolveLlamaCppGatewayPort,
  type LlamaCppModelGateway,
} from './llamacppModelGateway';
import { stopOwnedProcess, terminateProcessTree } from './ownedProcessStop';
import { scanLocalModelsAsync } from '../workbenchTask/artifactWorkerPool';
import { createLlamaCppServerSpawnOptions } from './llamacppProcessLifecycle';
import { buildLlamaCppServeEnv } from './llamacppServe';
import { LlamaCppRouterLogSplitter } from './llamacppRouterLogSplitter';
import {
  buildLlamaCppRouterProcessArgs,
  findAvailableLlamaCppRouterPort,
  upsertLlamaCppRouterModelPresetSection,
  writeLlamaCppRouterPresetGlobalSection,
} from './llamacppRouterProcess';
import type { LlamaCppRouterModelSlots, LlamaCppRouterModelSnapshot } from './llamacppRouterStatus';
import { LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN } from './llamacppRouterStatus';
import { findLlamaCppExecutable } from './llamacppRuntimePaths';

const LLAMACPP_ROUTER_START_TIMEOUT_MS = 10_000;
const LLAMACPP_ROUTER_START_POLL_INTERVAL_MS = 150;
const LLAMACPP_ROUTER_STOP_UNLOAD_BUDGET_MS = 1_500;
const LLAMACPP_ROUTER_UNLOAD_TIMEOUT_MS = 15_000;
const LLAMACPP_ROUTER_UNLOAD_POLL_INTERVAL_MS = 150;
const LLAMACPP_ROUTER_RECONNECT_TIMEOUT_MS = 2_000;
const LLAMACPP_ROUTER_LOG_TAIL_ERROR_LINES = 30;
const LLAMACPP_ROUTER_DEFAULT_TIMEOUT_SECONDS = 120;
const LLAMACPP_ROUTER_STILL_STOPPING = 'The previous local inference router is still stopping.';

type KeyValueStore = {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
};

type RouterInstance = {
  client: LlamaCppClient;
  modelsDir: string;
  presetPath: string;
};

export type LlamaCppRouterOrchestratorOptions = {
  userDataPath: string;
  getStore: () => KeyValueStore;
  getServiceConfig: () => LlamaCppServiceConfig;
  getModelsDir: () => string;
  stopPreviousDaemon?: () => Promise<void>;
  /** Spawns the router process; overridable in tests. */
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  /** Resolves the llama-server executable; overridable in tests. */
  resolveExecutable?: (config: LlamaCppServiceConfig) => Promise<string | null>;
  /**
   * Integrates gateway acquisitions with the main-process residency in-flight
   * counting: returns the lease release. Optional so tests can omit it.
   */
  acquireModelLease?: (modelName: string, load: () => Promise<void>) => Promise<() => void>;
};

/**
 * In-process orchestrator that runs one llama-server router bound to an
 * ephemeral loopback port with `--models-max 0 --no-models-autoload`, so the
 * app owns capacity, eviction and idle unloading instead of the router's
 * unsafe LRU. The shared loopback gateway keeps owning config.port for
 * on-demand loads and the loaded-only model listing; LAN access is served by
 * the bundled model gateway. All router HTTP goes through one LlamaCppClient
 * pointed at the router's loopback base URL.
 */
export class LlamaCppRouterOrchestrator implements LlamaCppModelOrchestrator {
  private readonly credentials: LlamaCppGatewayCredentialVault;
  private readonly spawnProcess: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => ChildProcess;
  private readonly resolveExecutable: (config: LlamaCppServiceConfig) => Promise<string | null>;

  private routerProcess: ChildProcess | null = null;
  private routerPort: number | null = null;
  private router: RouterInstance | null = null;
  private splitter: LlamaCppRouterLogSplitter | null = null;
  private readonly gateway: LlamaCppModelGateway;
  private lastRunningModels: LlamaCppRunningModel[] = [];
  private starting: Promise<void> | null = null;
  private previousDaemonStop?: Promise<void>;
  private stopping: Promise<void> | null = null;
  private routerStopping: Promise<void> | undefined;
  private readonly quitController = new AbortController();

  constructor(private readonly options: LlamaCppRouterOrchestratorOptions) {
    this.credentials = new LlamaCppGatewayCredentialVault(options.getStore());
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.resolveExecutable = options.resolveExecutable ?? findLlamaCppExecutable;
    this.gateway = createLlamaCppModelGateway({
      shutdownSignal: this.quitController.signal,
      acquireModel: async modelName => this.acquireGatewayModel(modelName),
      listModels: () =>
        this.lastRunningModels.map(model => ({
          id: (model.name || model.model || model.id || '').trim(),
        })),
    });
  }

  async reconnect(options?: {
    requireResponsive?: boolean;
  }): Promise<LlamaCppModelDaemonStatus | null> {
    if (options?.requireResponsive && (this.starting || this.stopping)) {
      throw new Error('The local inference router is changing state.');
    }
    // The router is an in-process child with no on-disk registry, so there is
    // nothing to reconnect to across app restarts; report live state only.
    const child = this.routerProcess;
    const router = this.router;
    if (!child) return null;
    if (!router) {
      if (options?.requireResponsive) throw new Error(LLAMACPP_ROUTER_STILL_STOPPING);
      return null;
    }
    const ownsLiveChild = () =>
      this.routerProcess === child &&
      this.router === router &&
      child.exitCode === null &&
      child.signalCode === null;
    const isCurrent = () =>
      ownsLiveChild() &&
      !this.starting &&
      !this.gateway.isChanging() &&
      !this.stopping &&
      !this.quitController.signal.aborted;
    if (!isCurrent()) {
      if (options?.requireResponsive && ownsLiveChild()) {
        throw new Error('The local inference router is changing state.');
      }
      return null;
    }
    try {
      const models = await router.client.listModelsSnapshot(LLAMACPP_ROUTER_RECONNECT_TIMEOUT_MS);
      const processes = options?.requireResponsive
        ? await router.client.listRouterModels(LLAMACPP_ROUTER_RECONNECT_TIMEOUT_MS)
        : undefined;
      if (!isCurrent()) return null;
      this.lastRunningModels = toRunningModels(models);
      const status = this.currentStatus();
      if (processes) {
        status.modelProcesses = processes.filter(ownsModelProcess).map(model => ({
          modelName: model.id,
          modelPath: model.modelPath ?? '',
          port: model.port ?? 0,
        }));
      }
      return status;
    } catch (error) {
      if (options?.requireResponsive && ownsLiveChild()) throw error;
      return null;
    }
  }

  async start(): Promise<LlamaCppStatusSnapshot> {
    try {
      await this.ensureStarted();
      this.lastRunningModels = await this.fetchRunningModels();
      return { status: 'running', managedByApp: true, checkedAt: new Date().toISOString() };
    } catch (error) {
      return {
        status: 'stopped',
        managedByApp: true,
        error: toErrorMessage(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async listRunningModels(): Promise<LlamaCppRunningModel[]> {
    await this.ensureStarted();
    this.lastRunningModels = await this.fetchRunningModels();
    return this.lastRunningModels;
  }

  async ensureModel(input: LlamaCppModelLaunchInput): Promise<LlamaCppModelDaemonStatus> {
    const { signal } = this.quitController;
    const modelName = input.model.trim();
    if (!modelName) throw new Error('Model name is required.');
    await this.ensureStarted();
    const router = this.currentRouter();
    this.assertCurrentRouter(router);

    // Already resident: never rewrite the preset, since a changed section makes
    // the router restart a running instance (and an option-less gateway load
    // would drop the ctx/GPU options of the last explicit load).
    const known = (await router.client.listRouterModels()).find(model => model.id === modelName);
    this.assertCurrentRouter(router);
    if (known?.state === 'loaded' || known?.state === 'sleeping') {
      this.lastRunningModels = await this.fetchRunningModels(router);
      return this.currentStatus();
    }
    const modelPath =
      input.modelPath?.trim() ||
      known?.modelPath ||
      (await this.findLocalModel(router.modelsDir, modelName, signal))?.path;
    this.assertCurrentRouter(router);
    if (!modelPath) throw new Error(`Local model was not found: ${modelName}.`);

    if (input.options || input.modelPath || !known) {
      upsertLlamaCppRouterModelPresetSection({
        presetPath: router.presetPath,
        modelName,
        modelPath,
        options: input.options,
      });
      // listModels performs GET /models?reload=1 so the router sees the section.
      await router.client.listModels({ signal });
    }

    this.assertCurrentRouter(router);
    try {
      const { runningModels } = await router.client.loadModel(
        { model: modelName, ...(input.options ? { options: input.options } : {}) },
        { signal },
      );
      this.assertCurrentRouter(router);
      this.lastRunningModels = toRunningModels(runningModels);
    } catch (error) {
      this.assertCurrentRouter(router);
      throw this.describeModelFailure(modelName, error);
    }
    return this.currentStatus();
  }

  async stopModel(modelName: string): Promise<LlamaCppModelDaemonStatus> {
    const normalizedModelName = modelName.trim();
    const router = this.router;
    if (!router || !normalizedModelName) return this.currentStatus();
    await router.client.unloadModel(normalizedModelName).catch((): undefined => undefined);
    if (this.router === router) {
      this.lastRunningModels = this.lastRunningModels.filter(
        model => (model.name || model.model || model.id) !== normalizedModelName,
      );
    }
    return this.currentStatus();
  }

  async stopAll(): Promise<LlamaCppModelDaemonStatus> {
    await this.unloadRouterModels();
    return this.currentStatus();
  }

  async deleteModelFile(modelName: string, modelPath: string): Promise<void> {
    const router = this.router;
    if (router) {
      this.assertCurrentRouter(router);
      await this.unloadRouterModels(
        undefined,
        model => model.id === modelName || model.modelPath === modelPath,
      );
      this.assertCurrentRouter(router);
    }
    await unlink(modelPath);
  }

  private async unloadRouterModels(
    deadline = Date.now() + LLAMACPP_ROUTER_UNLOAD_TIMEOUT_MS,
    matches?: (model: LlamaCppRouterModelSnapshot) => boolean,
  ): Promise<void> {
    const router = this.router;
    if (!router) return;
    const { client } = router;
    const remaining = () => {
      if (this.router !== router) throw new Error('The local inference router has stopped.');
      const ms = deadline - Date.now();
      if (ms <= 0) throw new Error('Local model unload timed out.');
      return ms;
    };
    const isActiveTarget = (model: LlamaCppRouterModelSnapshot) =>
      ownsModelProcess(model) && (!matches || matches(model));
    for (const model of (await client.listRouterModels(remaining())).filter(isActiveTarget)) {
      await client.unloadModel(model.id, remaining());
    }
    while ((await client.listRouterModels(remaining())).some(isActiveTarget)) {
      await waitMs(Math.min(remaining(), LLAMACPP_ROUTER_UNLOAD_POLL_INTERVAL_MS));
    }
    if (this.router === router && !matches) this.lastRunningModels = [];
  }

  async applyConfig(config: LlamaCppServiceConfig): Promise<LlamaCppModelDaemonStatus> {
    await this.ensureStarted(config);
    await this.applyConfigWhileRunning(config);
    return this.currentStatus();
  }

  async applyConfigIfRunning(config: LlamaCppServiceConfig): Promise<LlamaCppModelDaemonStatus> {
    if (this.stopping) await this.stopping;
    if (!this.routerProcess) return this.stoppedStatus();
    return await this.applyConfig(config);
  }

  async restart(config: LlamaCppServiceConfig): Promise<LlamaCppStatusSnapshot> {
    this.quitController.signal.throwIfAborted();
    await this.stopService();
    await this.ensureStarted(config);
    return { status: 'running', managedByApp: true, checkedAt: new Date().toISOString() };
  }

  async stopService(): Promise<void> {
    if (this.stopping) return await this.stopping;
    this.stopping = this.stopEverything().finally(() => {
      this.stopping = null;
    });
    return await this.stopping;
  }

  getCachedRunningModels(): LlamaCppRunningModel[] {
    return this.lastRunningModels;
  }

  /**
   * Router mode never leaves a resident process behind: models are unloaded
   * and the router exits with the app (keepRunningOnAppQuit is ignored).
   */
  async shutdownForQuit(): Promise<void> {
    this.quitController.abort(new Error('The local inference router is shutting down.'));
    const previousDaemonStop = this.previousDaemonStop;
    try {
      await this.stopService();
    } finally {
      await previousDaemonStop;
    }
  }

  async finishDaemonHandoff(): Promise<void> {
    this.quitController.signal.throwIfAborted();
    this.previousDaemonStop ??= this.options.stopPreviousDaemon?.().catch(error => {
      this.previousDaemonStop = undefined;
      throw error;
    });
    await this.previousDaemonStop;
    this.quitController.signal.throwIfAborted();
  }

  gatewayBaseUrl(): string | null {
    return this.router ? this.gateway.baseUrl() : null;
  }

  getLanToken(): string {
    return this.credentials.ensureLanToken();
  }

  async regenerateLanToken(): Promise<string> {
    // The bundled model gateway authenticates LAN requests; its imported key is
    // replaced through the management API, not by this loopback path.
    return this.credentials.regenerateLanToken();
  }

  /** In-flight probe for one model; any failure reports busy so callers never evict unknown state. */
  async getModelSlots(modelName: string): Promise<LlamaCppRouterModelSlots> {
    if (!this.router) return LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN;
    return await this.router.client.getModelSlots(modelName);
  }

  private async ensureStarted(config?: LlamaCppServiceConfig): Promise<void> {
    const { signal } = this.quitController;
    signal.throwIfAborted();
    if (this.stopping) await this.stopping;
    signal.throwIfAborted();
    if (this.starting) return await this.starting;
    if (this.router) return;
    if (this.routerProcess) throw new Error(LLAMACPP_ROUTER_STILL_STOPPING);
    this.starting = this.startRouter(config).finally(() => {
      this.starting = null;
    });
    return await this.starting;
  }

  private async startRouter(config?: LlamaCppServiceConfig): Promise<void> {
    const { signal } = this.quitController;
    if (this.options.stopPreviousDaemon) {
      await this.finishDaemonHandoff();
      signal.throwIfAborted();
    }
    const serviceConfig = config ?? this.options.getServiceConfig();
    const modelsDir = path.resolve(serviceConfig.modelsDir?.trim() || this.options.getModelsDir());
    // Per-model INI sections contain absolute paths, so they belong to one library.
    const libraryKey = createHash('sha256').update(modelsDir).digest('hex');
    const presetPath = path.join(
      this.options.userDataPath,
      'llamacpp',
      'router-presets',
      `${libraryKey}.ini`,
    );
    const executablePath = await this.resolveExecutable(serviceConfig);
    signal.throwIfAborted();
    if (!executablePath) throw new Error('llama.cpp runtime is not installed.');

    const port = await findAvailableLlamaCppRouterPort();
    signal.throwIfAborted();
    writeLlamaCppRouterPresetGlobalSection({ presetPath, config: serviceConfig });

    const splitter = new LlamaCppRouterLogSplitter({ userDataPath: this.options.userDataPath });
    const args = buildLlamaCppRouterProcessArgs({
      config: serviceConfig,
      modelsDir,
      presetPath,
      port,
    });
    const child = this.spawnProcess(executablePath, args, {
      ...createLlamaCppServerSpawnOptions({
        config: { ...serviceConfig, keepRunningOnAppQuit: false },
        env: buildLlamaCppServeEnv(process.env, executablePath, process.platform),
      }),
      // A separate POSIX process group includes the model workers forked by the router.
      detached: process.platform !== 'win32',
    });
    let spawnError: Error | null = null;
    child.once('error', error => {
      spawnError = error;
    });
    child.stdout?.on('data', (chunk: Buffer) => splitter.appendChunk(chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => splitter.appendChunk(chunk.toString()));
    child.once('exit', () => {
      splitter.flush();
      if (this.routerProcess === child) this.clearRuntimeState();
    });

    const client = new LlamaCppClient(`http://127.0.0.1:${port}`, {
      loadTimeoutMs: this.resolveModelStartupTimeoutMs(),
    });
    this.routerProcess = child;
    this.splitter = splitter;

    try {
      const deadline = Date.now() + LLAMACPP_ROUTER_START_TIMEOUT_MS;
      let lastError = 'llama.cpp router did not become ready.';
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (spawnError || child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `llama.cpp router exited during startup (code ${child.exitCode ?? 'null'}): ${spawnError?.message ?? lastError}`,
          );
        }
        try {
          await client.health(1_000);
          signal.throwIfAborted();
          await this.gateway.start(resolveLlamaCppGatewayPort(serviceConfig.port));
          signal.throwIfAborted();
          if (this.routerProcess !== child) throw new Error('The local inference router exited.');
          this.routerPort = port;
          this.router = { client, modelsDir, presetPath };
          return;
        } catch (error) {
          signal.throwIfAborted();
          lastError = toErrorMessage(error);
          await waitMs(LLAMACPP_ROUTER_START_POLL_INTERVAL_MS);
        }
      }
      throw new Error(lastError);
    } catch (error) {
      if (!signal.aborted) {
        const gatewayStopped = this.gateway.stop().catch(() => {});
        try {
          if (this.routerProcess === child) await this.stopRouterChild(child);
        } catch (stopError) {
          throw new Error(`${toErrorMessage(error)}. ${toErrorMessage(stopError)}`, {
            cause: stopError,
          });
        } finally {
          await gatewayStopped;
          await splitter.idle().catch(() => {});
        }
      }
      throw error;
    }
  }

  /**
   * Applies a config change while the router keeps running: the preset's
   * global GPU section is refreshed so subsequent model loads pick up the new
   * service-level options (the router command line itself is fixed at spawn,
   * like daemon model processes reading config at their own spawn time), and
   * the gateway listener restarts only when its port changed.
   */
  private async applyConfigWhileRunning(config: LlamaCppServiceConfig): Promise<void> {
    const router = this.currentRouter();
    this.assertCurrentRouter(router);
    writeLlamaCppRouterPresetGlobalSection({ presetPath: router.presetPath, config });
    await this.gateway.start(resolveLlamaCppGatewayPort(config.port));
  }

  private async acquireGatewayModel(
    modelName: string,
  ): Promise<{ baseUrl: string; release: () => void }> {
    const { signal } = this.quitController;
    signal.throwIfAborted();
    const router = this.router;
    if (!router || !this.routerPort || this.stopping) {
      throw new Error('The local inference router is not running.');
    }
    const baseUrl = `http://127.0.0.1:${this.routerPort}`;
    const load = async (): Promise<void> => {
      this.assertCurrentRouter(router);
      await this.ensureModel({ model: modelName });
    };
    if (this.options.acquireModelLease) {
      const release = await this.options.acquireModelLease(modelName, load);
      try {
        this.assertCurrentRouter(router);
      } catch (error) {
        release();
        throw error;
      }
      return { baseUrl, release };
    }
    await load();
    this.assertCurrentRouter(router);
    return { baseUrl, release: (): void => undefined };
  }

  private async stopEverything(): Promise<void> {
    const { signal } = this.quitController;
    if (this.starting && !signal.aborted) {
      const quitting = Promise.withResolvers<void>();
      const listener = addAbortListener(signal, () => quitting.resolve());
      try {
        await Promise.race([this.starting.catch(() => {}), quitting.promise]);
      } finally {
        listener[Symbol.dispose]();
      }
    }

    const child = this.routerProcess;
    const splitter = this.splitter;
    const gatewayStopped = this.gateway.stop().catch(() => {});
    try {
      if (child && !this.starting) await this.unloadBeforeStop();
      if (child) await this.stopRouterChild(child);
    } finally {
      await gatewayStopped;
      this.lastRunningModels = [];
      await splitter?.idle().catch((): undefined => undefined);
    }
  }

  private stopRouterChild(child: ChildProcess): Promise<void> {
    const stop = process.platform === 'win32' ? stopOwnedProcess : terminateProcessTree;
    return (this.routerStopping ??= stop(child)
      .then(() => {
        if (this.routerProcess === child) this.clearRuntimeState();
      })
      .finally(() => {
        this.routerStopping = undefined;
      }));
  }

  private async unloadBeforeStop(): Promise<void> {
    const deadline = Date.now() + LLAMACPP_ROUTER_STOP_UNLOAD_BUDGET_MS;
    const budget = Promise.withResolvers<void>();
    const timer = setTimeout(budget.resolve, LLAMACPP_ROUTER_STOP_UNLOAD_BUDGET_MS);
    try {
      await Promise.race([this.unloadRouterModels(deadline).catch(() => {}), budget.promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private clearRuntimeState(): void {
    this.routerProcess = null;
    this.routerPort = null;
    this.router = null;
    this.splitter = null;
  }

  private currentRouter(): RouterInstance {
    if (!this.router) throw new Error('The local inference router is not running.');
    return this.router;
  }

  private assertCurrentRouter(router: RouterInstance): void {
    this.quitController.signal.throwIfAborted();
    if (this.router !== router || this.stopping) {
      throw new Error('The local inference router has stopped.');
    }
  }

  private async fetchRunningModels(router = this.currentRouter()): Promise<LlamaCppRunningModel[]> {
    const { signal } = this.quitController;
    this.assertCurrentRouter(router);
    const models = await router.client.listModels({ signal });
    this.assertCurrentRouter(router);
    return toRunningModels(models);
  }

  private async findLocalModel(
    modelsDir: string,
    modelName: string,
    signal: AbortSignal,
  ): Promise<LlamaCppModel | undefined> {
    return (await scanLocalModelsAsync(modelsDir, signal)).find(
      model => model.name === modelName || model.id === modelName || model.model === modelName,
    );
  }

  private resolveModelStartupTimeoutMs(): number {
    const configuredSeconds = Number.parseInt(this.options.getServiceConfig().timeout ?? '', 10);
    const seconds =
      Number.isFinite(configuredSeconds) && configuredSeconds > 0
        ? configuredSeconds
        : LLAMACPP_ROUTER_DEFAULT_TIMEOUT_SECONDS;
    return seconds * 1000;
  }

  /** Error text for the classifier: the model's log tail from its most recent spawn. */
  private describeModelFailure(modelName: string, cause: unknown): Error {
    const tail =
      this.splitter?.getRecentLines(modelName, LLAMACPP_ROUTER_LOG_TAIL_ERROR_LINES) ?? [];
    if (tail.length === 0) {
      return cause instanceof Error ? cause : new Error(String(cause));
    }
    return new Error(`llama.cpp could not load model ${modelName}:\n${tail.join('\n')}`);
  }

  private currentStatus(): LlamaCppModelDaemonStatus {
    if (!this.router) return this.stoppedStatus();
    return {
      status: { status: 'running', managedByApp: true, checkedAt: new Date().toISOString() },
      runningModels: this.lastRunningModels,
      modelProcesses: this.lastRunningModels.map(model => ({
        modelName: (model.name || model.model || model.id || '').trim(),
        modelPath: model.path ?? '',
        port: this.routerPort ?? 0,
      })),
      gatewayBaseUrl: this.gatewayBaseUrl(),
    };
  }

  private stoppedStatus(): LlamaCppModelDaemonStatus {
    this.lastRunningModels = [];
    return {
      status: { status: 'stopped', managedByApp: true, checkedAt: new Date().toISOString() },
      runningModels: [],
      modelProcesses: [],
      gatewayBaseUrl: null,
    };
  }
}

function toRunningModels(models: LlamaCppModel[]): LlamaCppRunningModel[] {
  return models.filter(
    model => model.status === 'loaded' || model.status === 'sleeping',
  ) as LlamaCppRunningModel[];
}

function ownsModelProcess(model: LlamaCppRouterModelSnapshot): boolean {
  // Router publishes the terminal state after reaping the child. Its launch args may keep the port.
  return model.state !== 'unloaded' && model.state !== 'failed';
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitMs(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}
