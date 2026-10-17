// Core state, status plumbing, and startup health helpers (#1069).
import { type ChildProcess } from 'child_process';
import { app, net } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import type { LlamaCppServiceConfig, LlamaCppStatusSnapshot } from '../../../shared/llamacpp';
import { LlamaCppClient } from '../llamacppClient';
import { getDefaultLlamaCppModelsDir } from '../llamacppModelLibraryPath';
import { findLlamaCppExecutable, resolveLlamaCppRuntimeMetadata } from '../llamacppRuntimePaths';
import { MarketplaceService } from '../marketplaceService';
import {
  LlamaCppManagerLifecycleEvent,
  LlamaCppProcessOutputStream,
  type LlamaCppProcessOutputEvent,
} from './types';
import { normalizePositiveInteger } from './fileUtils';

export class LlamaCppManagerCore extends EventEmitter {
  protected executablePath: string | null = null;
  protected process: ChildProcess | null = null;
  protected runtimeContextLengthByModel = new Map<string, number>();
  protected thinkingToggleSupportByModel = new Map<string, boolean>();
  protected startupStderr = '';
  protected readonly marketplaceService: MarketplaceService;
  protected readonly storage?: LlamaCppManagerStorage;
  protected backendListCache: LlamaCppBackendListCacheEntry | null = null;
  /** Message of the last router-listing failure; repeats stay at debug level. */
  protected routerListFailure: string | null = null;
  protected status: LlamaCppStatusSnapshot = {
    status: 'unknown',
    checkedAt: new Date().toISOString(),
  };

  constructor(
    protected readonly getServiceConfig: () => LlamaCppServiceConfig = () => ({}),
    marketplaceService?: MarketplaceService,
    storage?: LlamaCppManagerStorage,
  ) {
    super();
    this.marketplaceService =
      marketplaceService ??
      new MarketplaceService(() => this.getModelsDir(), {
        fetchImpl: net.fetch,
        cacheDir: path.join(app.getPath('userData'), 'marketplace-cache'),
      });
    this.storage = storage;
  }

  getStatus(): LlamaCppStatusSnapshot {
    return this.status;
  }

  protected handleProcessOutput(
    stream: (typeof LlamaCppProcessOutputStream)[keyof typeof LlamaCppProcessOutputStream],
    chunk: Buffer,
  ): string {
    const text = chunk.toString().trim();
    if (!text) return '';

    if (stream === LlamaCppProcessOutputStream.Stdout) {
      console.debug(`[LlamaCpp] ${text}`);
    } else {
      console.warn(`[LlamaCpp] ${text}`);
    }

    this.emit(LlamaCppManagerLifecycleEvent.ProcessOutput, {
      stream,
      text,
      createdAt: new Date().toISOString(),
      ...(this.process?.pid ? { pid: this.process.pid } : {}),
    } satisfies LlamaCppProcessOutputEvent);

    return text;
  }

  getBaseUrl(): string {
    const config = this.getServiceConfig();
    const host =
      config.host?.trim() === '0.0.0.0' ? DEFAULT_HOST : config.host?.trim() || DEFAULT_HOST;
    const port = config.port?.trim() || DEFAULT_PORT;
    return `http://${host}:${port}`;
  }

  getModelsDir(): string {
    return (
      this.getServiceConfig().modelsDir?.trim() ||
      getDefaultLlamaCppModelsDir({
        platform: process.platform,
        appDataPath: app.getPath('appData'),
        userDataPath: app.getPath('userData'),
        localAppDataPath: process.env.LOCALAPPDATA,
      })
    );
  }

  initializeModelsDir(): string {
    const modelsDir = this.getModelsDir();
    fs.mkdirSync(modelsDir, { recursive: true });
    return modelsDir;
  }

  getPresetPath(): string {
    return path.join(app.getPath('userData'), 'llamacpp', 'models-preset.ini');
  }

  getConnectionAndLoadTimeoutMs(): number {
    const configuredSeconds = normalizePositiveInteger(this.getServiceConfig().timeout);
    if (!configuredSeconds) return DEFAULT_CONNECTION_AND_LOAD_TIMEOUT_MS;
    return configuredSeconds * 1000;
  }

  protected getBackendListCacheKey(): string {
    const config = this.getServiceConfig();
    return [
      process.platform,
      process.arch,
      config.runtimeVersion?.trim() ?? '',
      config.runtimeBackend ?? '',
    ].join(':');
  }

  protected clearBackendListCache(): void {
    this.backendListCache = null;
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
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = '8080';
const DEFAULT_CONNECTION_AND_LOAD_TIMEOUT_MS = 120_000;

type LlamaCppBackendListCacheEntry = {
  key: string;
  expiresAt: number;
  result: import('../../../shared/llamacpp').LlamaCppBackendListResult;
};

type LlamaCppManagerStorage = {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
};
