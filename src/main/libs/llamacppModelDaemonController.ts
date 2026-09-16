import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

import type {
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { readLlamaCppModelDaemonRegistry, writeLlamaCppModelDaemonRegistry } from './llamacppModelDaemonRegistry';
import {
  LlamaCppModelDaemonCommand,
  type LlamaCppModelDaemonBootstrap,
  type LlamaCppModelDaemonRequest,
  type LlamaCppModelDaemonResponse,
  type LlamaCppModelDaemonStatus,
} from './llamacppModelDaemonProtocol';
import { LlamaCppGatewayCredentialVault } from './llamacppGatewayCredentialVault';

const CONTROL_CONNECT_TIMEOUT_MS = 1_000;
const DAEMON_START_TIMEOUT_MS = 10_000;
const DAEMON_START_POLL_INTERVAL_MS = 150;

type KeyValueStore = {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
};

export class LlamaCppModelDaemonController {
  private readonly credentials: LlamaCppGatewayCredentialVault;
  private controlPort: number | null = null;
  private lastStatus: LlamaCppModelDaemonStatus | null = null;
  private lastError: string | undefined;
  private starting: Promise<LlamaCppModelDaemonStatus> | null = null;

  constructor(
    private readonly options: {
      userDataPath: string;
      getStore: () => KeyValueStore;
      getServiceConfig: () => LlamaCppServiceConfig;
    },
  ) {
    this.credentials = new LlamaCppGatewayCredentialVault(options.getStore());
  }

  async reconnect(): Promise<LlamaCppModelDaemonStatus | null> {
    const registry = await readLlamaCppModelDaemonRegistry(this.options.userDataPath);
    if (!registry) return null;
    this.controlPort = registry.controlPort;
    try {
      return await this.request({ command: LlamaCppModelDaemonCommand.Status });
    } catch {
      this.controlPort = null;
      return null;
    }
  }

  async status(): Promise<LlamaCppStatusSnapshot> {
    try {
      const status = await this.ensureStarted();
      return status.status;
    } catch (error) {
      this.lastError = toErrorMessage(error);
      return {
        status: 'stopped',
        managedByApp: true,
        error: this.lastError,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async listRunningModels(): Promise<LlamaCppRunningModel[]> {
    const status = await this.ensureStarted();
    return status.runningModels;
  }

  async ensureModel(input: LlamaCppModelLaunchInput): Promise<LlamaCppModelDaemonStatus> {
    await this.ensureStarted();
    return await this.request({ command: LlamaCppModelDaemonCommand.EnsureModel, input });
  }

  async stopModel(modelName: string): Promise<LlamaCppModelDaemonStatus> {
    if (!this.controlPort) {
      await this.reconnect();
    }
    if (!this.controlPort) return this.stoppedStatus();
    return await this.request({ command: LlamaCppModelDaemonCommand.StopModel, modelName });
  }

  async stopAll(): Promise<LlamaCppModelDaemonStatus> {
    if (!this.controlPort) {
      await this.reconnect();
    }
    if (!this.controlPort) return this.stoppedStatus();
    return await this.request({ command: LlamaCppModelDaemonCommand.StopAll });
  }

  async applyConfig(config: LlamaCppServiceConfig): Promise<LlamaCppModelDaemonStatus> {
    await this.ensureStarted();
    const lanToken = this.isLanMode(config) ? this.credentials.ensureLanToken() : undefined;
    return await this.request({
      command: LlamaCppModelDaemonCommand.ApplyConfig,
      serviceConfig: config,
      ...(lanToken ? { lanToken } : {}),
    });
  }

  async applyConfigIfRunning(config: LlamaCppServiceConfig): Promise<LlamaCppModelDaemonStatus> {
    if (!this.controlPort) {
      await this.reconnect();
    }
    if (!this.controlPort) return this.stoppedStatus();
    const lanToken = this.isLanMode(config) ? this.credentials.ensureLanToken() : undefined;
    return await this.request({
      command: LlamaCppModelDaemonCommand.ApplyConfig,
      serviceConfig: config,
      ...(lanToken ? { lanToken } : {}),
    });
  }

  async restart(config: LlamaCppServiceConfig): Promise<LlamaCppStatusSnapshot> {
    await this.stopService();
    await this.applyConfig(config);
    return (await this.ensureStarted()).status;
  }

  async stopService(): Promise<void> {
    if (!this.controlPort) return;
    await this.request({ command: LlamaCppModelDaemonCommand.StopAll }).catch((): undefined => undefined);
    await this.request({ command: LlamaCppModelDaemonCommand.Shutdown }).catch((): undefined => undefined);
    this.controlPort = null;
    this.lastStatus = null;
  }

  getCachedRunningModels(): LlamaCppRunningModel[] {
    return this.lastStatus?.runningModels ?? [];
  }

  async shutdownForQuit(): Promise<void> {
    if (this.options.getServiceConfig().keepRunningOnAppQuit !== false) return;
    if (!this.controlPort) return;
    await this.stopService();
  }

  gatewayBaseUrl(): string | null {
    return this.lastStatus?.gatewayBaseUrl ?? null;
  }

  getLanToken(): string {
    return this.credentials.ensureLanToken();
  }

  async regenerateLanToken(): Promise<string> {
    const token = this.credentials.regenerateLanToken();
    const config = this.options.getServiceConfig();
    if (this.isLanMode(config) && this.controlPort) {
      await this.applyConfig(config);
    }
    return token;
  }

  private async ensureStarted(): Promise<LlamaCppModelDaemonStatus> {
    if (this.starting) return await this.starting;
    if (this.controlPort) {
      try {
        return await this.request({ command: LlamaCppModelDaemonCommand.Status });
      } catch {
        this.controlPort = null;
      }
    }
    this.starting = this.startNewDaemon().finally(() => {
      this.starting = null;
    });
    return await this.starting;
  }

  private stoppedStatus(): LlamaCppModelDaemonStatus {
    return {
      status: {
        status: 'stopped',
        managedByApp: true,
        checkedAt: new Date().toISOString(),
      },
      runningModels: [],
      modelProcesses: [],
      gatewayBaseUrl: null,
    };
  }

  private async startNewDaemon(): Promise<LlamaCppModelDaemonStatus> {
    const controlPort = await findAvailableLoopbackPort();
    const serviceConfig = this.options.getServiceConfig();
    const bootstrap: LlamaCppModelDaemonBootstrap = {
      controlPort,
      controlToken: this.credentials.ensureControlToken(),
      userDataPath: this.options.userDataPath,
      serviceConfig,
      ...(this.isLanMode(serviceConfig) ? { lanToken: this.credentials.ensureLanToken() } : {}),
    };
    const entryPath = path.resolve(__dirname, '../llamacppModelDaemonEntry.js');
    const child = spawn(process.execPath, [entryPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ZHIYUAN_LLAMACPP_DAEMON_BOOTSTRAP: Buffer.from(JSON.stringify(bootstrap)).toString('base64url'),
      },
    });
    child.unref();
    this.controlPort = controlPort;

    const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
    let latestError = 'Local inference daemon did not become ready.';
    while (Date.now() < deadline) {
      try {
        const status = await this.request({ command: LlamaCppModelDaemonCommand.Status });
        await this.persistRegistry(child.pid, status);
        return status;
      } catch (error) {
        latestError = toErrorMessage(error);
        await wait(DAEMON_START_POLL_INTERVAL_MS);
      }
    }
    this.controlPort = null;
    throw new Error(latestError);
  }

  private async request(input: LlamaCppModelDaemonRequest): Promise<LlamaCppModelDaemonStatus> {
    if (!this.controlPort) throw new Error('Local inference daemon is unavailable.');
    const response = await fetch(`http://127.0.0.1:${this.controlPort}/control`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.credentials.ensureControlToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(CONTROL_CONNECT_TIMEOUT_MS),
    });
    const payload = (await response.json()) as LlamaCppModelDaemonResponse;
    if (!response.ok || payload.success === false) {
      throw new Error(payload.success === false ? payload.error : 'Local inference daemon request failed.');
    }
    this.lastStatus = payload.status;
    this.lastError = undefined;
    await this.persistRegistry(undefined, payload.status);
    return payload.status;
  }

  private async persistRegistry(pid: number | undefined, status: LlamaCppModelDaemonStatus): Promise<void> {
    if (!this.controlPort) return;
    const existing = await readLlamaCppModelDaemonRegistry(this.options.userDataPath);
    await writeLlamaCppModelDaemonRegistry(this.options.userDataPath, {
      version: 1,
      pid: pid ?? existing?.pid ?? process.pid,
      controlPort: this.controlPort,
      gatewayPort: Number.parseInt(this.options.getServiceConfig().port ?? '8080', 10) || 8080,
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      models: status.modelProcesses.map(model => ({
        modelName: model.modelName,
        modelPath: model.modelPath,
        port: model.port,
        logSessionId: '',
      })),
    });
  }

  private isLanMode(config: LlamaCppServiceConfig): boolean {
    return config.gatewayAccessMode === 'lan' || config.listenHost === '0.0.0.0';
  }
}

async function findAvailableLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a daemon control port.'));
        return;
      }
      server.close(error => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function wait(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
