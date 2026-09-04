import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';

import {
  ENGRAM_DATA_DIRECTORY_SEGMENTS,
  ENGRAM_LOOPBACK_HOST,
  EngramEnvironment,
  EngramManagerPhase,
} from './constants';
import {
  createAuthenticatedEngramProxy,
  type AuthenticatedEngramProxy,
} from './authenticatedProxy';
import { resolveEngramBinary } from './binaryResolver';
import type { EngramConnection, EngramManagerStatus } from './types';

const START_TIMEOUT_MS = 10_000;
const HEALTH_POLL_MS = 100;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAYS_MS = [500, 1_000, 2_000] as const;

interface EngramProcess extends Pick<ChildProcess, 'once' | 'kill' | 'pid'> {}

export interface EngramManagerOptions {
  userDataPath: string;
  resourcesPath?: string;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  fileExists?: (candidate: string) => boolean;
  spawnProcess?: (binaryPath: string, env: NodeJS.ProcessEnv) => EngramProcess;
  reservePort?: () => Promise<number>;
  createProxy?: typeof createAuthenticatedEngramProxy;
  checkHealth?: (connection: EngramConnection) => Promise<boolean>;
  restartDelaysMs?: readonly number[];
}

export class EngramManager {
  private status: EngramManagerStatus = {
    phase: EngramManagerPhase.Stopped,
    available: false,
    restartAttempts: 0,
  };
  private connection: EngramConnection | null = null;
  private child: EngramProcess | null = null;
  private proxy: AuthenticatedEngramProxy | null = null;
  private startPromise: Promise<EngramConnection | null> | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private shouldRun = false;
  private generation = 0;

  constructor(private readonly options: EngramManagerOptions) {}

  getStatus(): EngramManagerStatus {
    return { ...this.status };
  }

  getConnection(): EngramConnection | null {
    if (this.status.phase !== EngramManagerPhase.Running || !this.status.available) return null;
    return this.connection ? { ...this.connection } : null;
  }

  start(): Promise<EngramConnection | null> {
    this.shouldRun = true;
    if (this.connection) return Promise.resolve({ ...this.connection });
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal()
      .catch(async (error: unknown): Promise<null> => {
        await this.disposeCurrentInstance();
        this.status = {
          phase: EngramManagerPhase.Degraded,
          available: false,
          restartAttempts: this.status.restartAttempts,
          error: error instanceof Error ? error.message : String(error),
        };
        console.warn('[MemoryRuntime] Failed to start local memory service:', error);
        this.scheduleRestart();
        return null;
      })
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.shouldRun = false;
    this.generation += 1;
    this.status = { ...this.status, phase: EngramManagerPhase.Stopping, available: false };
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const proxy = this.proxy;
    const child = this.child;
    this.proxy = null;
    this.child = null;
    this.connection = null;
    if (proxy) await proxy.close().catch((): undefined => undefined);
    child?.kill();
    this.status = {
      phase: EngramManagerPhase.Stopped,
      available: false,
      restartAttempts: 0,
    };
  }

  private async startInternal(): Promise<EngramConnection | null> {
    const binaryPath = resolveEngramBinary({
      env: this.options.env,
      resourcesPath: this.options.resourcesPath,
      projectRoot: this.options.projectRoot,
      fileExists: this.options.fileExists,
    });
    if (!binaryPath) {
      this.status = {
        phase: EngramManagerPhase.Degraded,
        available: false,
        restartAttempts: this.status.restartAttempts,
        error: 'Bundled memory runtime is unavailable.',
      };
      console.warn('[MemoryRuntime] Bundled runtime is unavailable; continuing without memory.');
      return null;
    }

    this.status = { ...this.status, phase: EngramManagerPhase.Starting, available: false };
    const generation = ++this.generation;
    const token = randomBytes(32).toString('hex');
    const backendPort = await (this.options.reservePort ?? reserveLoopbackPort)();
    const proxy = await (this.options.createProxy ?? createAuthenticatedEngramProxy)({
      backendPort,
      token,
    });
    const dataDirectory = path.join(this.options.userDataPath, ...ENGRAM_DATA_DIRECTORY_SEGMENTS);
    fs.mkdirSync(dataDirectory, { recursive: true });
    const childEnvironment: NodeJS.ProcessEnv = {
      ...(this.options.env ?? process.env),
      [EngramEnvironment.DataDirectory]: dataDirectory,
      [EngramEnvironment.Port]: String(backendPort),
      [EngramEnvironment.HttpToken]: token,
      [EngramEnvironment.CloudAutosync]: '0',
    };
    this.proxy = proxy;
    const child = (this.options.spawnProcess ?? spawnEngram)(binaryPath, childEnvironment);
    this.child = child;
    this.connection = { url: proxy.url, token };
    child.once('exit', () => this.handleUnexpectedExit(generation));
    child.once('error', error => this.handleUnexpectedExit(generation, error));

    const healthy = await this.waitForHealth(this.connection);
    if (!healthy || generation !== this.generation) {
      await this.disposeCurrentInstance();
      this.status = {
        phase: EngramManagerPhase.Degraded,
        available: false,
        restartAttempts: this.status.restartAttempts,
        error: 'Memory runtime failed its startup health check.',
      };
      this.scheduleRestart();
      return null;
    }

    this.status = {
      phase: EngramManagerPhase.Running,
      available: true,
      restartAttempts: 0,
    };
    console.log('[MemoryRuntime] Local memory service started.');
    return { ...this.connection };
  }

  private async waitForHealth(connection: EngramConnection): Promise<boolean> {
    const checkHealth = this.options.checkHealth ?? defaultHealthCheck;
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await checkHealth(connection).catch(() => false)) return true;
      await new Promise(resolve => setTimeout(resolve, HEALTH_POLL_MS));
    }
    return false;
  }

  private handleUnexpectedExit(generation: number, error?: Error): void {
    if (generation !== this.generation || !this.shouldRun) return;
    this.generation += 1;
    this.child = null;
    this.connection = null;
    const proxy = this.proxy;
    this.proxy = null;
    void proxy?.close().catch((): undefined => undefined);
    this.status = {
      phase: EngramManagerPhase.Degraded,
      available: false,
      restartAttempts: this.status.restartAttempts,
      error: error?.message ?? 'Memory runtime exited unexpectedly.',
    };
    if (error) {
      console.warn('[MemoryRuntime] Local memory service failed:', error);
    } else {
      console.warn('[MemoryRuntime] Local memory service exited unexpectedly.');
    }
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (!this.shouldRun || this.restartTimer) return;
    const delays = this.options.restartDelaysMs ?? RESTART_DELAYS_MS;
    if (this.status.restartAttempts >= Math.min(MAX_RESTART_ATTEMPTS, delays.length)) return;
    const attempt = this.status.restartAttempts + 1;
    const delay = delays[attempt - 1] ?? delays[delays.length - 1] ?? 1_000;
    this.status = { ...this.status, restartAttempts: attempt };
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start();
    }, delay);
  }

  private async disposeCurrentInstance(): Promise<void> {
    this.generation += 1;
    const proxy = this.proxy;
    const child = this.child;
    this.proxy = null;
    this.child = null;
    this.connection = null;
    if (proxy) await proxy.close().catch((): undefined => undefined);
    child?.kill();
  }
}

function spawnEngram(binaryPath: string, env: NodeJS.ProcessEnv): EngramProcess {
  return spawn(binaryPath, ['serve'], {
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
}

async function reserveLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, ENGRAM_LOOPBACK_HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to reserve a memory service port.'));
        return;
      }
      server.close(error => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function defaultHealthCheck(connection: EngramConnection): Promise<boolean> {
  const response = await fetch(`${connection.url}/health`, {
    headers: { Authorization: `Bearer ${connection.token}` },
    signal: AbortSignal.timeout(500),
  });
  return response.ok;
}
