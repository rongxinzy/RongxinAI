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
import { stopOwnedProcess } from '../libs/ownedProcessStop';
import { resolveEngramBinary } from './binaryResolver';
import type { EngramConnection, EngramManagerStatus } from './types';

const START_TIMEOUT_MS = 10_000;
const HEALTH_POLL_MS = 100;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAYS_MS = [500, 1_000, 2_000] as const;

interface EngramProcess extends Pick<
  ChildProcess,
  'on' | 'once' | 'removeListener' | 'kill' | 'pid' | 'exitCode' | 'signalCode'
> {}

export interface EngramManagerOptions {
  userDataPath: string;
  resourcesPath?: string;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  fileExists?: (candidate: string) => boolean;
  spawnProcess?: (binaryPath: string, env: NodeJS.ProcessEnv) => EngramProcess;
  reservePort?: () => Promise<number>;
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
  private childStop: Promise<void> | undefined;
  private startPromise: Promise<EngramConnection | null> | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private shouldRun = false;
  private closed = false;
  private generation = 0;

  constructor(private readonly options: EngramManagerOptions) {}

  getStatus(): EngramManagerStatus {
    return { ...this.status };
  }

  start(): Promise<EngramConnection | null> {
    if (this.closed || this.childStop) return Promise.resolve(null);
    if (this.startPromise) return this.startPromise;
    if (this.connection) return Promise.resolve({ ...this.connection });
    if (this.child) return Promise.resolve(null); // An earlier stop could not confirm exit.
    this.shouldRun = true;
    const generation = ++this.generation;
    this.startPromise = this.startInternal(generation)
      .catch(async (error: unknown): Promise<null> => {
        if (generation !== this.generation) return null;
        await this.disposeCurrentInstance()?.catch(stopError => {
          console.warn('[MemoryRuntime] Failed to stop the unhealthy process:', stopError);
        });
        if (generation !== this.generation) return null;
        this.status = {
          phase: EngramManagerPhase.Degraded,
          available: false,
          restartAttempts: this.status.restartAttempts,
          error: error instanceof Error ? error.message : String(error),
        };
        console.warn('[MemoryRuntime] Failed to start local memory service:', error);
        return null;
      })
      .finally(() => {
        this.startPromise = null;
        if (this.status.phase === EngramManagerPhase.Degraded) this.scheduleRestart();
      });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.closed = true;
    this.shouldRun = false;
    this.generation += 1;
    this.status = { ...this.status, phase: EngramManagerPhase.Stopping, available: false };
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    await this.disposeCurrentInstance();
    this.status = {
      phase: EngramManagerPhase.Stopped,
      available: false,
      restartAttempts: 0,
    };
  }

  private async startInternal(generation: number): Promise<EngramConnection | null> {
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
      this.shouldRun = false;
      console.warn('[MemoryRuntime] Bundled runtime is unavailable; continuing without memory.');
      return null;
    }

    this.status = { ...this.status, phase: EngramManagerPhase.Starting, available: false };
    const token = randomBytes(32).toString('hex');
    const backendPort = await (this.options.reservePort ?? reserveLoopbackPort)();
    if (generation !== this.generation) return null;
    const dataDirectory = path.join(this.options.userDataPath, ...ENGRAM_DATA_DIRECTORY_SEGMENTS);
    fs.mkdirSync(dataDirectory, { recursive: true });
    const childEnvironment: NodeJS.ProcessEnv = {
      ...(this.options.env ?? process.env),
      [EngramEnvironment.DataDirectory]: dataDirectory,
      [EngramEnvironment.Port]: String(backendPort),
      [EngramEnvironment.HttpToken]: token,
      [EngramEnvironment.CloudAutosync]: '0',
    };
    const child = (this.options.spawnProcess ?? spawnEngram)(binaryPath, childEnvironment);
    this.child = child;
    // The boundary is the loopback bind on a reserved random port: only local
    // processes can reach the runtime. The token is defense in depth — as of
    // rongxinzy/engram v3.6.0-zhiyuan.2 the runtime only enforces it on the
    // destructive and export routes (delete observation/session, export,
    // import, project migration); search and writes are unauthenticated, and
    // the adapter sends the bearer token on every request anyway. The only
    // client is the in-process adapter, so no proxy hop is needed.
    this.connection = { url: `http://${ENGRAM_LOOPBACK_HOST}:${backendPort}`, token };
    child.once('exit', () => {
      this.handleUnexpectedExit(generation);
      if (this.child === child) this.child = null;
      if (this.status.phase === EngramManagerPhase.Degraded) this.scheduleRestart();
    });
    child.on('error', error => {
      if (child.pid === undefined) this.handleUnexpectedExit(generation, error);
      else console.warn('[MemoryRuntime] Local memory process error:', error);
    });

    const healthy = await this.waitForHealth(this.connection, generation);
    if (generation !== this.generation) return null;
    if (!healthy) throw new Error('Memory runtime failed its startup health check.');

    this.status = {
      phase: EngramManagerPhase.Running,
      available: true,
      restartAttempts: 0,
    };
    console.log('[MemoryRuntime] Local memory service started.');
    return { ...this.connection };
  }

  private async waitForHealth(connection: EngramConnection, generation: number): Promise<boolean> {
    const checkHealth = this.options.checkHealth ?? defaultHealthCheck;
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (generation === this.generation && Date.now() < deadline) {
      if (await checkHealth(connection).catch(() => false)) return true;
      if (generation !== this.generation) break;
      await new Promise(resolve => setTimeout(resolve, HEALTH_POLL_MS));
    }
    return false;
  }

  private handleUnexpectedExit(generation: number, error?: Error): void {
    if (generation !== this.generation || !this.connection) return;
    this.generation += 1;
    this.child = null;
    this.connection = null;
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
  }

  private scheduleRestart(): void {
    if (!this.shouldRun || this.child || this.childStop || this.startPromise || this.restartTimer)
      return;
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

  private disposeCurrentInstance(): Promise<void> | undefined {
    this.connection = null;
    if (this.childStop) return this.childStop;
    const child = this.child;
    if (!child?.pid) {
      this.child = null;
      return;
    }
    this.childStop = stopOwnedProcess(child)
      .then(() => {
        this.child = null;
      })
      .finally(() => {
        this.childStop = undefined;
      });
    return this.childStop;
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
