import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import type {
  StrataServiceConfig,
  StrataStartInput,
  StrataStatusSnapshot,
} from '../../../shared/strata/types';
import { StrataServiceStatus } from '../../../shared/strata/types';
import { STRATA_DEFAULT_SERVE_PORT } from '../../../shared/strata/constants';
import { getStrataCatalogEntry } from './strataModelCatalog';
import {
  readStrataBundledManifest,
  resolveStrataBundledRoot,
  resolveStrataDefaultPort,
} from './strataBundledManifest';
import { isStrataFeatureEnabled } from './strataEditionPolicy';
import { StrataClient } from './strataClient';
import type { LlamaCppModelOrchestrator } from '../llamacppModelOrchestrator';
import { releaseGpuForStrata } from './gpuExclusiveInferenceCoordinator';

const START_TIMEOUT_MS = 120_000;

export class StrataManager extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private activeCatalogId: string | undefined;
  private status: StrataStatusSnapshot = {
    status: StrataServiceStatus.Unknown,
    checkedAt: new Date().toISOString(),
    bundled: isStrataFeatureEnabled(),
  };

  constructor(
    private readonly getServiceConfig: () => StrataServiceConfig = () => ({}),
    private readonly getOrchestrator: () => LlamaCppModelOrchestrator | null = () => null,
  ) {
    super();
  }

  isBundled(): boolean {
    return isStrataFeatureEnabled();
  }

  getStatus(): StrataStatusSnapshot {
    return this.status;
  }

  resolvePort(): number {
    const manifest = readStrataBundledManifest();
    const configured = this.getServiceConfig().port?.trim();
    if (configured) {
      const parsed = Number.parseInt(configured, 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) return parsed;
    }
    return resolveStrataDefaultPort(manifest);
  }

  baseUrl(): string | null {
    if (this.status.status !== StrataServiceStatus.Running) return null;
    return `http://127.0.0.1:${this.resolvePort()}/v1`;
  }

  async detect(): Promise<StrataStatusSnapshot> {
    if (!this.isBundled()) {
      this.setStatus({ status: StrataServiceStatus.NotBundled, bundled: false });
      return this.status;
    }
    const port = this.resolvePort();
    const client = new StrataClient(`http://127.0.0.1:${port}`);
    if (await client.health()) {
      this.setStatus({
        status: StrataServiceStatus.Running,
        port,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        activeModelId: this.activeCatalogId,
        managedByApp: Boolean(this.process),
        bundled: true,
      });
      return this.status;
    }
    this.setStatus({
      status: this.process ? StrataServiceStatus.Starting : StrataServiceStatus.Stopped,
      port,
      bundled: true,
      managedByApp: Boolean(this.process),
    });
    return this.status;
  }

  async start(input: StrataStartInput): Promise<StrataStatusSnapshot> {
    if (!this.isBundled()) {
      this.setStatus({ status: StrataServiceStatus.NotBundled, bundled: false });
      return this.status;
    }
    const entry = getStrataCatalogEntry(input.catalogId);
    if (!entry) {
      throw new Error(`Unknown Strata catalog id: ${input.catalogId}`);
    }
    if (
      (await this.detect()).status === StrataServiceStatus.Running &&
      this.activeCatalogId === entry.id
    ) {
      return this.status;
    }
    await this.stop();
    await releaseGpuForStrata(this.getOrchestrator());

    const bundledRoot = resolveStrataBundledRoot();
    const manifest = readStrataBundledManifest(bundledRoot);
    if (!bundledRoot || !manifest) {
      throw new Error('Strata bundled runtime is missing.');
    }

    const runtimeRoot = path.join(bundledRoot, manifest.runtimeRoot);
    const pythonExe = path.join(bundledRoot, manifest.pythonExecutable);
    const componentsDir = path.join(bundledRoot, manifest.componentsRoot);
    if (!fs.existsSync(pythonExe)) {
      throw new Error(`Strata bundled Python runtime missing: ${pythonExe}`);
    }

    const port = this.resolvePort();
    this.setStatus({
      status: StrataServiceStatus.Starting,
      port,
      bundled: true,
      managedByApp: true,
    });

    const args = [
      '-m',
      'strata_cli.cli',
      'launch',
      '--family',
      entry.family,
      '--model',
      entry.modelLaunchId,
      '--port',
      String(port),
      '--yes',
      '--replace',
      '--no-tui',
    ];

    const env = {
      ...process.env,
      STRATA_COMPONENTS_DIR: componentsDir,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    };

    this.process = spawn(pythonExe, args, {
      cwd: runtimeRoot,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    this.process.stdout.on('data', chunk => console.debug(`[Strata] ${chunk.toString().trim()}`));
    this.process.stderr.on('data', chunk => console.warn(`[Strata] ${chunk.toString().trim()}`));
    this.process.on('exit', (code, signal) => {
      console.log(
        `[Strata] process exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`,
      );
      this.process = null;
      if (
        this.status.status === StrataServiceStatus.Running ||
        this.status.status === StrataServiceStatus.Starting
      ) {
        this.setStatus({
          status: StrataServiceStatus.Stopped,
          port,
          bundled: true,
          managedByApp: false,
        });
      }
    });
    this.process.on('error', error => {
      console.warn('[Strata] process failed:', error);
      this.setStatus({
        status: StrataServiceStatus.Error,
        error: error.message,
        port,
        bundled: true,
        managedByApp: false,
      });
    });

    await this.waitUntilHealthy(START_TIMEOUT_MS);
    if (this.status.status === StrataServiceStatus.Running) {
      this.activeCatalogId = entry.id;
    }
    return this.status;
  }

  async stop(): Promise<StrataStatusSnapshot> {
    const port = this.resolvePort();
    if (!this.process) {
      this.setStatus({
        status: StrataServiceStatus.Stopped,
        port,
        bundled: this.isBundled(),
        managedByApp: false,
      });
      this.activeCatalogId = undefined;
      return this.status;
    }
    const child = this.process;
    this.setStatus({
      status: StrataServiceStatus.Stopping,
      port,
      bundled: true,
      managedByApp: true,
    });
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill('SIGTERM');
    });
    this.process = null;
    this.activeCatalogId = undefined;
    this.setStatus({
      status: StrataServiceStatus.Stopped,
      port,
      bundled: this.isBundled(),
      managedByApp: false,
    });
    return this.status;
  }

  async shutdownForQuit(): Promise<StrataStatusSnapshot> {
    return await this.stop();
  }

  private async waitUntilHealthy(timeoutMs: number): Promise<void> {
    const port = this.resolvePort();
    const client = new StrataClient(`http://127.0.0.1:${port}`);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await client.health()) {
        this.setStatus({
          status: StrataServiceStatus.Running,
          port,
          baseUrl: `http://127.0.0.1:${port}/v1`,
          managedByApp: true,
          bundled: true,
        });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    this.setStatus({
      status: StrataServiceStatus.Error,
      error: 'Strata did not become ready before timeout',
      port,
      bundled: true,
      managedByApp: Boolean(this.process),
    });
  }

  private setStatus(
    patch: Omit<Partial<StrataStatusSnapshot>, 'checkedAt'> & {
      status: StrataStatusSnapshot['status'];
    },
  ): void {
    this.status = {
      ...this.status,
      ...patch,
      checkedAt: new Date().toISOString(),
    };
    this.emit('status', this.status);
  }
}

export function parseStrataPort(config: StrataServiceConfig): number {
  const raw = config.port?.trim();
  if (!raw) return STRATA_DEFAULT_SERVE_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : STRATA_DEFAULT_SERVE_PORT;
}
