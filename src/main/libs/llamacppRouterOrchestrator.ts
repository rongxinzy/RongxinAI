import { type ChildProcess, spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';

import type {
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { LlamaCppGatewayAccessMode } from '../../shared/llamacpp';
import { LlamaCppClient } from './llamacppClient';
import { LlamaCppGatewayCredentialVault } from './llamacppGatewayCredentialVault';
import type { LlamaCppModelDaemonStatus } from './llamacppModelDaemonProtocol';
import type { LlamaCppModelOrchestrator } from './llamacppModelOrchestrator';
import { createLlamaCppModelGateway, type LlamaCppModelGateway } from './llamacppModelGateway';
import { scanLocalGgufModels } from './llamacppModelCatalog';
import { createLlamaCppServerSpawnOptions } from './llamacppProcessLifecycle';
import { buildLlamaCppServeEnv } from './llamacppServe';
import { LlamaCppRouterLogSplitter } from './llamacppRouterLogSplitter';
import {
  buildLlamaCppRouterProcessArgs,
  findAvailableLlamaCppRouterPort,
  upsertLlamaCppRouterModelPresetSection,
  writeLlamaCppRouterPresetGlobalSection,
} from './llamacppRouterProcess';
import type { LlamaCppRouterModelSlots } from './llamacppRouterStatus';
import { LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN } from './llamacppRouterStatus';
import { findLlamaCppExecutable } from './llamacppRuntimePaths';

const LLAMACPP_ROUTER_START_TIMEOUT_MS = 10_000;
const LLAMACPP_ROUTER_START_POLL_INTERVAL_MS = 150;
const LLAMACPP_ROUTER_KILL_GRACE_MS = 3_000;
const LLAMACPP_ROUTER_LOG_TAIL_ERROR_LINES = 30;
const LLAMACPP_ROUTER_DEFAULT_GATEWAY_PORT = 8080;
const LLAMACPP_ROUTER_DEFAULT_TIMEOUT_SECONDS = 120;

type KeyValueStore = {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
};

export type LlamaCppRouterOrchestratorOptions = {
  userDataPath: string;
  getStore: () => KeyValueStore;
  getServiceConfig: () => LlamaCppServiceConfig;
  getModelsDir: () => string;
  /** Preset INI path shared with the manager (manager.getPresetPath). */
  getPresetPath: () => string;
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
 * unsafe LRU. The shared gateway keeps owning config.port, so LAN access mode
 * and its bearer token behave exactly as in daemon mode. All router HTTP goes
 * through one LlamaCppClient pointed at the router's loopback base URL.
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
  private routerClient: LlamaCppClient | null = null;
  private splitter: LlamaCppRouterLogSplitter | null = null;
  private gateway: LlamaCppModelGateway | null = null;
  private gatewayPort = LLAMACPP_ROUTER_DEFAULT_GATEWAY_PORT;
  private gatewayLanMode = false;
  private lastRunningModels: LlamaCppRunningModel[] = [];
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;

  constructor(private readonly options: LlamaCppRouterOrchestratorOptions) {
    this.credentials = new LlamaCppGatewayCredentialVault(options.getStore());
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.resolveExecutable = options.resolveExecutable ?? findLlamaCppExecutable;
  }

  async reconnect(): Promise<LlamaCppModelDaemonStatus | null> {
    // The router is an in-process child with no on-disk registry, so there is
    // nothing to reconnect to across app restarts; report live state only.
    if (this.stopping) await this.stopping;
    return this.routerProcess ? this.currentStatus() : null;
  }

  async status(): Promise<LlamaCppStatusSnapshot> {
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
    const modelName = input.model.trim();
    if (!modelName) throw new Error('Model name is required.');
    await this.ensureStarted();

    // Already resident: never rewrite the preset, since a changed section makes
    // the router restart a running instance (and an option-less gateway load
    // would drop the ctx/GPU options of the last explicit load).
    const known = (await this.client().listRouterModels()).find(model => model.id === modelName);
    if (known?.state === 'loaded' || known?.state === 'sleeping') {
      this.lastRunningModels = await this.fetchRunningModels();
      return this.currentStatus();
    }
    const modelPath =
      input.modelPath?.trim() || known?.modelPath || this.findLocalModel(modelName)?.path;
    if (!modelPath) throw new Error(`Local model was not found: ${modelName}.`);

    if (input.options || input.modelPath || !known) {
      upsertLlamaCppRouterModelPresetSection({
        presetPath: this.options.getPresetPath(),
        modelName,
        modelPath,
        options: input.options,
      });
      // listModels performs GET /models?reload=1 so the router sees the section.
      await this.client().listModels();
    }

    try {
      await this.client().loadModel({
        model: modelName,
        ...(input.options ? { options: input.options } : {}),
      });
    } catch (error) {
      throw this.describeModelFailure(modelName, error);
    }
    this.lastRunningModels = await this.fetchRunningModels();
    return this.currentStatus();
  }

  async stopModel(modelName: string): Promise<LlamaCppModelDaemonStatus> {
    const normalizedModelName = modelName.trim();
    if (this.routerClient && normalizedModelName) {
      await this.routerClient.unloadModel(normalizedModelName).catch((): undefined => undefined);
      this.lastRunningModels = this.lastRunningModels.filter(
        model => (model.name || model.model || model.id) !== normalizedModelName,
      );
    }
    return this.currentStatus();
  }

  async stopAll(): Promise<LlamaCppModelDaemonStatus> {
    if (this.routerClient) {
      for (const model of [...this.lastRunningModels]) {
        const modelName = (model.name || model.model || model.id || '').trim();
        if (modelName) {
          await this.routerClient.unloadModel(modelName).catch((): undefined => undefined);
        }
      }
      this.lastRunningModels = [];
    }
    return this.currentStatus();
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
    await this.stopService();
  }

  gatewayBaseUrl(): string | null {
    return this.gateway?.baseUrl() ?? null;
  }

  getLanToken(): string {
    return this.credentials.ensureLanToken();
  }

  async regenerateLanToken(): Promise<string> {
    // The gateway reads the token through getConfig on every request, so a
    // refreshed token takes effect without restarting the listener.
    return this.credentials.regenerateLanToken();
  }

  /** In-flight probe for one model; any failure reports busy so callers never evict unknown state. */
  async getModelSlots(modelName: string): Promise<LlamaCppRouterModelSlots> {
    if (!this.routerClient) return LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN;
    return await this.routerClient.getModelSlots(modelName);
  }

  private async ensureStarted(config?: LlamaCppServiceConfig): Promise<void> {
    if (this.stopping) await this.stopping;
    if (this.routerProcess) return;
    if (this.starting) return await this.starting;
    this.starting = this.startRouter(config).finally(() => {
      this.starting = null;
    });
    return await this.starting;
  }

  private async startRouter(config?: LlamaCppServiceConfig): Promise<void> {
    const serviceConfig = config ?? this.options.getServiceConfig();
    const executablePath = await this.resolveExecutable(serviceConfig);
    if (!executablePath) throw new Error('llama.cpp runtime is not installed.');

    const port = await findAvailableLlamaCppRouterPort();
    writeLlamaCppRouterPresetGlobalSection({
      presetPath: this.options.getPresetPath(),
      config: serviceConfig,
    });

    const splitter = new LlamaCppRouterLogSplitter({ userDataPath: this.options.userDataPath });
    const args = buildLlamaCppRouterProcessArgs({
      config: serviceConfig,
      modelsDir: this.options.getModelsDir(),
      presetPath: this.options.getPresetPath(),
      port,
    });
    // Router mode never leaves a resident process behind, so the router always
    // spawns attached with piped stdio regardless of keepRunningOnAppQuit.
    const child = this.spawnProcess(
      executablePath,
      args,
      createLlamaCppServerSpawnOptions({
        config: { ...serviceConfig, keepRunningOnAppQuit: false },
        env: buildLlamaCppServeEnv(process.env, executablePath, process.platform),
      }),
    );
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
    this.routerPort = port;
    this.routerClient = client;
    this.splitter = splitter;

    try {
      const deadline = Date.now() + LLAMACPP_ROUTER_START_TIMEOUT_MS;
      let lastError = 'llama.cpp router did not become ready.';
      while (Date.now() < deadline) {
        if (spawnError || child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `llama.cpp router exited during startup (code ${child.exitCode ?? 'null'}): ${spawnError?.message ?? lastError}`,
          );
        }
        try {
          await client.health(1_000);
          await this.startGateway(serviceConfig);
          return;
        } catch (error) {
          lastError = toErrorMessage(error);
          await waitMs(LLAMACPP_ROUTER_START_POLL_INTERVAL_MS);
        }
      }
      throw new Error(lastError);
    } catch (error) {
      if (this.routerProcess === child) this.clearRuntimeState();
      child.kill();
      throw error;
    }
  }

  private async startGateway(config: LlamaCppServiceConfig): Promise<void> {
    await this.gateway?.stop().catch((): undefined => undefined);
    this.gateway = null;
    this.gatewayPort = parseGatewayPort(config);
    this.gatewayLanMode = isLanMode(config);
    const gateway = createLlamaCppModelGateway({
      acquireModel: async modelName => this.acquireGatewayModel(modelName),
      listModels: () =>
        this.lastRunningModels.map(model => ({
          id: (model.name || model.model || model.id || '').trim(),
        })),
      getConfig: () => {
        const liveConfig = this.options.getServiceConfig();
        const lanMode = isLanMode(liveConfig);
        return {
          port: parseGatewayPort(liveConfig),
          accessMode: lanMode ? LlamaCppGatewayAccessMode.Lan : LlamaCppGatewayAccessMode.Local,
          ...(lanMode ? { lanToken: this.credentials.ensureLanToken() } : {}),
        };
      },
    });
    await gateway.start();
    this.gateway = gateway;
  }

  /**
   * Applies a config change while the router keeps running: the preset's
   * global GPU section is refreshed so subsequent model loads pick up the new
   * service-level options (the router command line itself is fixed at spawn,
   * like daemon model processes reading config at their own spawn time), and
   * the gateway listener restarts only when its port or access mode changed.
   */
  private async applyConfigWhileRunning(config: LlamaCppServiceConfig): Promise<void> {
    writeLlamaCppRouterPresetGlobalSection({
      presetPath: this.options.getPresetPath(),
      config,
    });
    if (
      parseGatewayPort(config) !== this.gatewayPort ||
      isLanMode(config) !== this.gatewayLanMode
    ) {
      await this.startGateway(config);
    }
  }

  private async acquireGatewayModel(
    modelName: string,
  ): Promise<{ baseUrl: string; release: () => void }> {
    if (!this.routerClient || !this.routerPort) {
      throw new Error('The local inference router is not running.');
    }
    const baseUrl = `http://127.0.0.1:${this.routerPort}`;
    const load = async (): Promise<void> => {
      await this.ensureModel({ model: modelName });
    };
    if (this.options.acquireModelLease) {
      const release = await this.options.acquireModelLease(modelName, load);
      return { baseUrl, release };
    }
    await load();
    return { baseUrl, release: (): void => undefined };
  }

  private async stopEverything(): Promise<void> {
    if (this.starting) await this.starting.catch((): undefined => undefined);
    await this.stopAll().catch((): undefined => undefined);
    await this.gateway?.stop().catch((): undefined => undefined);
    this.gateway = null;

    const child = this.routerProcess;
    const splitter = this.splitter;
    this.clearRuntimeState();
    this.lastRunningModels = [];
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, LLAMACPP_ROUTER_KILL_GRACE_MS);
        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill('SIGTERM');
      });
    }
    await splitter?.idle().catch((): undefined => undefined);
  }

  private clearRuntimeState(): void {
    this.routerProcess = null;
    this.routerPort = null;
    this.routerClient = null;
    this.splitter = null;
  }

  private client(): LlamaCppClient {
    if (!this.routerClient) throw new Error('The local inference router is not running.');
    return this.routerClient;
  }

  private async fetchRunningModels(): Promise<LlamaCppRunningModel[]> {
    return toRunningModels(await this.client().listModels());
  }

  private findLocalModel(modelName: string): LlamaCppModel | undefined {
    const modelsDir =
      this.options.getServiceConfig().modelsDir?.trim() || this.options.getModelsDir();
    return scanLocalGgufModels(modelsDir).find(
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
    if (!this.routerProcess) return this.stoppedStatus();
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

function matchesName(model: LlamaCppModel, modelName: string): boolean {
  return [model.name, model.id, model.model].some(value => value?.trim() === modelName);
}

function parseGatewayPort(config: LlamaCppServiceConfig): number {
  return Number.parseInt(config.port ?? '', 10) || LLAMACPP_ROUTER_DEFAULT_GATEWAY_PORT;
}

function isLanMode(config: LlamaCppServiceConfig): boolean {
  return (
    config.gatewayAccessMode === LlamaCppGatewayAccessMode.Lan || config.listenHost === '0.0.0.0'
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitMs(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}
