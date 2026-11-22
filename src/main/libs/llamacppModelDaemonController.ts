import { spawn, type ChildProcess } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import type {
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { DEFAULT_LLAMACPP_SERVICE_CONFIG } from '../../shared/llamacpp/defaults';
import {
  readLlamaCppModelDaemonRegistry,
  removeLlamaCppModelDaemonRegistry,
  writeLlamaCppModelDaemonRegistry,
  type LlamaCppModelDaemonRegistryIdentity,
} from './llamacppModelDaemonRegistry';
import {
  LlamaCppModelDaemonCommand,
  LLAMACPP_MODEL_DAEMON_HANDOFF,
  type LlamaCppModelDaemonBootstrap,
  type LlamaCppModelDaemonRequest,
  type LlamaCppModelDaemonResponse,
  type LlamaCppModelDaemonStatus,
} from './llamacppModelDaemonProtocol';
import { LlamaCppGatewayCredentialVault } from './llamacppGatewayCredentialVault';
import type { LlamaCppModelOrchestrator } from './llamacppModelOrchestrator';
import { findLlamaCppExecutable } from './llamacppRuntimePaths';
import { OWNED_PROCESS_STOP_TIMEOUT_MS, stopOwnedProcess } from './ownedProcessStop';

const CONTROL_CONNECT_TIMEOUT_MS = 1_000;
const MODEL_STARTUP_CONTROL_REQUEST_GRACE_MS = 5_000;
const DAEMON_START_TIMEOUT_MS = 10_000;
const DAEMON_START_POLL_INTERVAL_MS = 150;
const DAEMON_STOP_TIMEOUT_MS = 10_000;
const DAEMON_STOP_POLL_INTERVAL_MS = 150;
const MAX_DAEMON_STARTUP_OUTPUT_LENGTH = 4_000;

type PendingDaemon = {
  child: ChildProcess;
  startup: AbortController;
  stopped?: Promise<void>;
};

export function resolveLlamaCppModelDaemonEntryPath(bundleDirectory: string): string {
  return path.join(bundleDirectory, 'llamacppModelDaemonEntry.js');
}

export function formatLlamaCppDaemonStartupFailure(input: {
  message: string;
  output?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
}): string {
  const details = [input.message.trim() || 'Local inference daemon did not become ready.'];
  if (input.exitCode !== undefined && input.exitCode !== null) {
    details.push(`daemon exited with code ${input.exitCode}`);
  }
  if (input.signal) details.push(`daemon exited with signal ${input.signal}`);
  const output = input.output?.trim();
  if (output) details.push(output.slice(-MAX_DAEMON_STARTUP_OUTPUT_LENGTH));
  return details.join('\n');
}

export function resolveLlamaCppModelDaemonRequestTimeoutMs(
  command: LlamaCppModelDaemonCommand,
  serviceConfig: LlamaCppServiceConfig,
): number {
  if (
    command === LlamaCppModelDaemonCommand.StopModel ||
    command === LlamaCppModelDaemonCommand.StopAll ||
    command === LlamaCppModelDaemonCommand.DeleteModelFile
  ) {
    return OWNED_PROCESS_STOP_TIMEOUT_MS + CONTROL_CONNECT_TIMEOUT_MS;
  }
  if (command !== LlamaCppModelDaemonCommand.EnsureModel) {
    return CONTROL_CONNECT_TIMEOUT_MS;
  }
  const configuredTimeoutSeconds =
    Number.parseInt(
      serviceConfig.timeout ?? DEFAULT_LLAMACPP_SERVICE_CONFIG.timeout ?? '120',
      10,
    ) || 120;
  return Math.max(1, configuredTimeoutSeconds) * 1000 + MODEL_STARTUP_CONTROL_REQUEST_GRACE_MS;
}

type KeyValueStore = {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
};

export class LlamaCppModelDaemonController implements LlamaCppModelOrchestrator {
  private readonly credentials: LlamaCppGatewayCredentialVault;
  private controlPort: number | null = null;
  private lastStatus: LlamaCppModelDaemonStatus | null = null;
  private lastError: string | undefined;
  private starting: Promise<LlamaCppModelDaemonStatus> | null = null;
  private pendingDaemon: PendingDaemon | null = null;
  private stopping: Promise<void> | null = null;
  private quitting = false;

  constructor(
    private readonly options: {
      userDataPath: string;
      getStore: () => KeyValueStore;
      getServiceConfig: () => LlamaCppServiceConfig;
    },
  ) {
    this.credentials = new LlamaCppGatewayCredentialVault(options.getStore());
  }

  async reconnect(options?: {
    requireResponsive?: boolean;
  }): Promise<LlamaCppModelDaemonStatus | null> {
    if (this.stopping) await this.stopping;
    if (this.starting) {
      return options?.requireResponsive
        ? await this.starting
        : await this.starting.catch((): null => null);
    }
    return await this.tryReconnect(options?.requireResponsive);
  }

  private async tryReconnect(
    requireResponsive = false,
    controlToken?: string,
  ): Promise<LlamaCppModelDaemonStatus | null> {
    const registry = await readLlamaCppModelDaemonRegistry(this.options.userDataPath);
    if (!registry) return null;
    this.controlPort = registry.controlPort;
    try {
      return await this.request({ command: LlamaCppModelDaemonCommand.Status }, { controlToken });
    } catch (error) {
      this.controlPort = null;
      if (requireResponsive) {
        try {
          process.kill(registry.pid, 0);
        } catch (probeError) {
          if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') return null;
        }
        throw error;
      }
      return null;
    }
  }

  async start(): Promise<LlamaCppStatusSnapshot> {
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

  async deleteModelFile(modelName: string, modelPath: string): Promise<void> {
    if (!(await this.reconnect({ requireResponsive: true }))) {
      await unlink(modelPath);
      return;
    }
    await this.request({
      command: LlamaCppModelDaemonCommand.DeleteModelFile,
      modelName,
      modelPath,
    });
  }

  async applyConfig(config: LlamaCppServiceConfig): Promise<LlamaCppModelDaemonStatus> {
    await this.ensureStarted();
    return await this.request({
      command: LlamaCppModelDaemonCommand.ApplyConfig,
      serviceConfig: config,
    });
  }

  async applyConfigIfRunning(config: LlamaCppServiceConfig): Promise<LlamaCppModelDaemonStatus> {
    if (!this.controlPort) {
      await this.reconnect();
    }
    if (!this.controlPort) return this.stoppedStatus();
    return await this.request({
      command: LlamaCppModelDaemonCommand.ApplyConfig,
      serviceConfig: config,
    });
  }

  async restart(config: LlamaCppServiceConfig): Promise<LlamaCppStatusSnapshot> {
    this.assertCanStart();
    await this.stopService();
    await this.applyConfig(config);
    return (await this.ensureStarted()).status;
  }

  async stopService(options?: { requireIdle?: boolean }): Promise<void> {
    return await this.stop(options?.requireIdle);
  }

  private async stop(requireIdle?: boolean, quitToken?: string | null): Promise<void> {
    if (this.stopping) return await this.stopping;
    this.stopping = this.stopCurrentService(requireIdle, quitToken).finally(() => {
      this.stopping = null;
    });
    return await this.stopping;
  }

  getCachedRunningModels(): LlamaCppRunningModel[] {
    return this.lastStatus?.runningModels ?? [];
  }

  async shutdownForQuit(): Promise<void> {
    this.quitting = true;
    if (this.options.getServiceConfig().keepRunningOnAppQuit !== false) return;
    // Control requests during process teardown must not access SQLite.
    const controlToken = this.credentials.readControlToken() ?? null;
    await this.stop(false, controlToken);
  }

  gatewayBaseUrl(): string | null {
    return this.lastStatus?.gatewayBaseUrl ?? null;
  }

  getLanToken(): string {
    return this.credentials.ensureLanToken();
  }

  async regenerateLanToken(): Promise<string> {
    // The bundled model gateway owns LAN authentication; its imported key is
    // replaced through the management API, not by the daemon's loopback path.
    return this.credentials.regenerateLanToken();
  }

  private async ensureStarted(): Promise<LlamaCppModelDaemonStatus> {
    this.assertCanStart();
    if (this.stopping) await this.stopping;
    this.assertCanStart();
    if (this.starting) return await this.starting;
    if (this.controlPort) {
      try {
        return await this.request({ command: LlamaCppModelDaemonCommand.Status });
      } catch {
        this.controlPort = null;
      }
    }
    this.assertCanStart();
    this.starting ??= this.reconnectOrStart().finally(() => {
      this.starting = null;
    });
    return await this.starting;
  }

  private async reconnectOrStart(): Promise<LlamaCppModelDaemonStatus> {
    const reconnected = await this.tryReconnect();
    return reconnected ?? (await this.startNewDaemon());
  }

  private async stopCurrentService(requireIdle = false, quitToken?: string | null): Promise<void> {
    const pending = this.pendingDaemon;
    if (pending) {
      pending.startup.abort(new Error('Local inference daemon startup was stopped.'));
      await stopPendingDaemon(pending);
      await this.starting?.catch((): undefined => undefined);
      this.lastStatus = null;
      return;
    }
    if (this.starting) await this.starting.catch((): undefined => undefined);
    if (quitToken === null) return;
    if (!this.controlPort) await this.tryReconnect(requireIdle, quitToken);
    if (!this.controlPort) {
      this.lastStatus = null;
      return;
    }

    const controlPort = this.controlPort;
    const controlToken = quitToken ?? this.credentials.ensureControlToken();
    if (requireIdle) {
      await this.request({ command: LlamaCppModelDaemonCommand.ShutdownIfIdle }, { controlToken });
    } else {
      await this.request({ command: LlamaCppModelDaemonCommand.Shutdown }, { controlToken }).catch(
        (): undefined => undefined,
      );
    }
    await this.waitForControlPortToClose(controlPort, controlToken);
    if (this.controlPort === controlPort) this.controlPort = null;
    this.lastStatus = null;
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
    this.assertCanStart();
    const controlPort = await findAvailableLoopbackPort();
    this.assertCanStart();
    const serviceConfig = this.options.getServiceConfig();
    const executablePath = await findLlamaCppExecutable(serviceConfig);
    this.assertCanStart();
    if (!executablePath) throw new Error('llama.cpp runtime is not installed.');
    const bootstrap: LlamaCppModelDaemonBootstrap = {
      controlPort,
      controlToken: this.credentials.ensureControlToken(),
      userDataPath: this.options.userDataPath,
      executablePath,
      serviceConfig,
    };
    const entryPath = resolveLlamaCppModelDaemonEntryPath(__dirname);
    const child = spawn(process.execPath, [entryPath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ZHIYUAN_LLAMACPP_DAEMON_BOOTSTRAP: Buffer.from(JSON.stringify(bootstrap)).toString(
          'base64url',
        ),
      },
    });
    let startupError: Error | null = null;
    let exitCode: number | null | undefined;
    let exitSignal: NodeJS.Signals | null | undefined;
    let startupOutput = '';
    const captureStartupOutput = (chunk: Buffer) => {
      startupOutput = `${startupOutput}${chunk.toString()}`.slice(
        -MAX_DAEMON_STARTUP_OUTPUT_LENGTH,
      );
    };
    child.stdout?.on('data', captureStartupOutput);
    child.stderr?.on('data', captureStartupOutput);
    child.once('error', error => {
      startupError = error;
    });
    child.once('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
    });
    child.unref();
    const pending = { child, startup: new AbortController() };
    this.pendingDaemon = pending;
    const { signal } = pending.startup;
    let publishing: LlamaCppModelDaemonRegistryIdentity | undefined;

    try {
      const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
      let latestError = 'Local inference daemon did not become ready.';
      let status: LlamaCppModelDaemonStatus | undefined;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (startupError || exitCode !== undefined) {
          throw new Error(
            formatLlamaCppDaemonStartupFailure({
              message: startupError?.message ?? latestError,
              output: startupOutput,
              exitCode,
              signal: exitSignal,
            }),
          );
        }
        try {
          status = await this.request(
            { command: LlamaCppModelDaemonCommand.Status },
            {
              controlPort,
              signal,
            },
          );
          break;
        } catch (error) {
          signal.throwIfAborted();
          latestError = toErrorMessage(error);
          await sleep(DAEMON_START_POLL_INTERVAL_MS, undefined, { signal });
        }
      }
      if (!status || !child.pid || !child.connected) {
        throw new Error(
          formatLlamaCppDaemonStartupFailure({
            message: latestError,
            output: startupOutput,
            exitCode,
            signal: exitSignal,
          }),
        );
      }
      signal.throwIfAborted();
      publishing = { controlPort, pid: child.pid, startedAt: new Date().toISOString() };
      await writeLlamaCppModelDaemonRegistry(this.options.userDataPath, publishing);
      signal.throwIfAborted();
      if (!child.connected) throw new Error('Local inference daemon disconnected during startup.');
      child.send(LLAMACPP_MODEL_DAEMON_HANDOFF);
      child.disconnect();
      this.controlPort = controlPort;
      this.lastStatus = status;
      this.lastError = undefined;
      return status;
    } catch (error) {
      try {
        await stopPendingDaemon(pending);
        if (publishing) {
          await removeLlamaCppModelDaemonRegistry(this.options.userDataPath, publishing);
        }
      } catch (cleanupError) {
        console.warn('[LlamaCppDaemon] could not clean up a failed startup:', cleanupError);
      }
      throw error;
    } finally {
      this.pendingDaemon = null;
    }
  }

  private async request(
    input: LlamaCppModelDaemonRequest,
    transport?: { controlPort?: number; signal?: AbortSignal; controlToken?: string },
  ): Promise<LlamaCppModelDaemonStatus> {
    if (
      input.command === LlamaCppModelDaemonCommand.EnsureModel ||
      input.command === LlamaCppModelDaemonCommand.ApplyConfig
    ) {
      this.assertCanStart();
    }
    const controlPort = transport?.controlPort ?? this.controlPort;
    if (!controlPort) throw new Error('Local inference daemon is unavailable.');
    const timeout = AbortSignal.timeout(
      resolveLlamaCppModelDaemonRequestTimeoutMs(
        input.command,
        input.command === LlamaCppModelDaemonCommand.EnsureModel
          ? this.options.getServiceConfig()
          : {},
      ),
    );
    const response = await fetch(`http://127.0.0.1:${controlPort}/control`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${transport?.controlToken ?? this.credentials.ensureControlToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: transport?.signal ? AbortSignal.any([transport.signal, timeout]) : timeout,
    });
    const payload = (await response.json()) as LlamaCppModelDaemonResponse;
    if (!response.ok || payload.success === false) {
      throw new Error(
        payload.success === false ? payload.error : 'Local inference daemon request failed.',
      );
    }
    if (transport?.signal) return payload.status;
    this.lastStatus = payload.status;
    this.lastError = undefined;
    return payload.status;
  }

  private assertCanStart(): void {
    if (this.quitting) throw new Error('The local inference controller is shutting down.');
  }

  private async waitForControlPortToClose(
    controlPort: number,
    controlToken: string,
  ): Promise<void> {
    const deadline = Date.now() + DAEMON_STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        await fetch(`http://127.0.0.1:${controlPort}/control`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${controlToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ command: LlamaCppModelDaemonCommand.Status }),
          signal: AbortSignal.timeout(CONTROL_CONNECT_TIMEOUT_MS),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.cause as NodeJS.ErrnoException)?.code === 'ECONNREFUSED'
        ) {
          return;
        }
      }
      await wait(DAEMON_STOP_POLL_INTERVAL_MS);
    }
    throw new Error('Local inference daemon did not stop before timeout.');
  }
}

function stopPendingDaemon(pending: PendingDaemon): Promise<void> {
  pending.stopped ??= pending.child.pid ? stopOwnedProcess(pending.child) : Promise.resolve();
  return pending.stopped;
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
