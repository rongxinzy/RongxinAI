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
const HEALTH_POLL_INTERVAL_MS = 500;
const STOP_GRACE_MS = 5_000;
const KILL_GRACE_MS = 2_000;

/** Lifecycle phases owned by start()/stop(); `detect()` never overrides them. */
type StrataPhase = 'idle' | 'starting' | 'stopping';

const STATUS_FIELDS = [
  'status',
  'port',
  'baseUrl',
  'activeModelId',
  'managedByApp',
  'error',
  'bundled',
] as const;

function statusesEqual(a: StrataStatusSnapshot, b: StrataStatusSnapshot): boolean {
  return STATUS_FIELDS.every(field => a[field] === b[field]);
}

export class StrataManager extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private activeCatalogId: string | undefined;
  private phase: StrataPhase = 'idle';
  /** Bumped by start()/stop(); async work from an older generation must not apply. */
  private generation = 0;
  private startInFlight: Promise<StrataStatusSnapshot> | null = null;
  private startCatalogId: string | undefined;
  private stopInFlight: Promise<StrataStatusSnapshot> | null = null;
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
    return { ...this.status };
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
    // start()/stop() own the status while a transition is running; a probe must
    // not race them into `starting` or `running`.
    if (this.phase !== 'idle') return this.status;
    const generation = this.generation;
    const port = this.resolvePort();
    const healthy = await new StrataClient(`http://127.0.0.1:${port}`).health();
    if (generation !== this.generation || this.phase !== 'idle') return this.status;
    if (healthy) {
      this.setStatus({
        status: StrataServiceStatus.Running,
        port,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        activeModelId: this.activeCatalogId,
        managedByApp: Boolean(this.process),
        bundled: true,
        error: undefined,
      });
      return this.status;
    }
    this.setStatus({
      status: this.process ? StrataServiceStatus.Starting : StrataServiceStatus.Stopped,
      port,
      baseUrl: undefined,
      activeModelId: undefined,
      managedByApp: Boolean(this.process),
      bundled: true,
      error: undefined,
    });
    return this.status;
  }

  async start(input: StrataStartInput): Promise<StrataStatusSnapshot> {
    // Coalesce duplicate requests for the same catalog, but never merge a
    // request for another catalog: supersede the old startup and run this one.
    while (this.startInFlight) {
      if (this.startCatalogId === input.catalogId) return this.startInFlight;
      await this.supersedeActiveStart(this.startInFlight);
    }
    const task = this.runStart(input);
    this.startInFlight = task;
    this.startCatalogId = input.catalogId;
    try {
      return await task;
    } finally {
      if (this.startInFlight === task) {
        this.startInFlight = null;
        this.startCatalogId = undefined;
      }
    }
  }

  /**
   * Cancels an in-flight startup for a different catalog. The superseded
   * caller gets a stopped snapshot; the new caller only proceeds after the old
   * child is gone, so two starts can never share process/status state.
   */
  private async supersedeActiveStart(pending: Promise<StrataStatusSnapshot>): Promise<void> {
    this.generation++;
    // Keep probes out while the superseded child is being killed; the new
    // start runs only after this cleanup and then owns the status again.
    this.phase = 'stopping';
    this.activeCatalogId = undefined;
    const port = this.resolvePort();
    this.setStatus({
      status: StrataServiceStatus.Stopped,
      port,
      baseUrl: undefined,
      activeModelId: undefined,
      bundled: this.isBundled(),
      managedByApp: false,
      error: undefined,
    });
    const child = this.process;
    if (child) await this.terminateChild(child);
    await pending.catch(() => {});
    if (this.phase === 'stopping') this.phase = 'idle';
    if (this.startInFlight === pending) {
      this.startInFlight = null;
      this.startCatalogId = undefined;
    }
  }

  private async runStart(input: StrataStartInput): Promise<StrataStatusSnapshot> {
    if (!this.isBundled()) {
      this.setStatus({ status: StrataServiceStatus.NotBundled, bundled: false });
      return this.status;
    }
    const entry = getStrataCatalogEntry(input.catalogId);
    if (!entry) {
      throw new Error(`Unknown Strata catalog id: ${input.catalogId}`);
    }

    const generation = ++this.generation;
    // A stop() that was already running owns the old child. Wait for its
    // cleanup before probing, otherwise a stale health success could make this
    // start return `running` for a process stop() is about to kill.
    const pendingStop = this.stopInFlight;
    if (pendingStop) await pendingStop.catch(() => {});
    if (generation !== this.generation) return this.status;

    const port = this.resolvePort();
    const healthy = await new StrataClient(`http://127.0.0.1:${port}`).health();
    if (generation !== this.generation) return this.status;
    if (this.phase === 'idle' && healthy && this.activeCatalogId === entry.id) {
      this.setStatus({
        status: StrataServiceStatus.Running,
        port,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        activeModelId: entry.id,
        managedByApp: Boolean(this.process),
        bundled: true,
        error: undefined,
      });
      return this.status;
    }

    await this.terminateCurrentProcess();
    if (generation !== this.generation) return this.status;
    await releaseGpuForStrata(this.getOrchestrator());
    if (generation !== this.generation) return this.status;

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

    this.phase = 'starting';
    this.activeCatalogId = undefined;
    this.setStatus({
      status: StrataServiceStatus.Starting,
      port,
      baseUrl: undefined,
      activeModelId: undefined,
      bundled: true,
      managedByApp: true,
      error: undefined,
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

    try {
      const child = spawn(pythonExe, args, {
        cwd: runtimeRoot,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });
      this.process = child;
      this.attachProcessListeners(child, generation, port);
      await this.waitUntilHealthy(generation, child, port, entry.id, START_TIMEOUT_MS);
      // A stop() during startup owns the terminal snapshot; wait for its
      // cleanup so start() resolves with `stopped` rather than `stopping`.
      const cancellation = this.stopInFlight;
      if (generation !== this.generation && cancellation) await cancellation;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Strata] failed to spawn process:', error);
      if (generation === this.generation) {
        this.process = null;
        this.phase = 'idle';
        this.setStatus({
          status: StrataServiceStatus.Error,
          error: message,
          port,
          baseUrl: undefined,
          activeModelId: undefined,
          bundled: true,
          managedByApp: false,
        });
      }
    } finally {
      if (this.phase === 'starting') this.phase = 'idle';
    }
    return this.status;
  }

  async stop(): Promise<StrataStatusSnapshot> {
    if (this.stopInFlight) return this.stopInFlight;
    const task = this.runStop();
    this.stopInFlight = task;
    try {
      return await task;
    } finally {
      if (this.stopInFlight === task) this.stopInFlight = null;
    }
  }

  private async runStop(): Promise<StrataStatusSnapshot> {
    const port = this.resolvePort();
    // Invalidate any in-flight detect()/start() work before touching the child.
    this.generation++;
    const child = this.process;
    if (!child) {
      this.phase = 'idle';
      this.activeCatalogId = undefined;
      this.setStatus({
        status: StrataServiceStatus.Stopped,
        port,
        baseUrl: undefined,
        activeModelId: undefined,
        bundled: this.isBundled(),
        managedByApp: false,
        error: undefined,
      });
      return this.status;
    }

    this.phase = 'stopping';
    this.setStatus({
      status: StrataServiceStatus.Stopping,
      port,
      baseUrl: undefined,
      activeModelId: undefined,
      bundled: true,
      managedByApp: true,
      error: undefined,
    });
    await this.terminateChild(child);
    this.activeCatalogId = undefined;
    this.phase = 'idle';
    this.setStatus({
      status: StrataServiceStatus.Stopped,
      port,
      baseUrl: undefined,
      activeModelId: undefined,
      bundled: this.isBundled(),
      managedByApp: false,
      error: undefined,
    });
    return this.status;
  }

  async shutdownForQuit(): Promise<StrataStatusSnapshot> {
    return await this.stop();
  }

  private attachProcessListeners(
    child: ChildProcessWithoutNullStreams,
    generation: number,
    port: number,
  ): void {
    child.stdout.on('data', chunk => console.debug(`[Strata] ${chunk.toString().trim()}`));
    child.stderr.on('data', chunk => console.warn(`[Strata] ${chunk.toString().trim()}`));
    child.on('exit', (code, signal) => {
      console.log(
        `[Strata] process exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`,
      );
      if (this.process !== child || generation !== this.generation) return;
      this.process = null;
      this.activeCatalogId = undefined;
      if (this.phase === 'stopping') return;
      const wasRunning = this.status.status === StrataServiceStatus.Running;
      this.phase = 'idle';
      this.setStatus({
        status: wasRunning ? StrataServiceStatus.Stopped : StrataServiceStatus.Error,
        error: wasRunning
          ? undefined
          : `Strata process exited before it became ready (code ${code ?? 'null'}, signal ${signal ?? 'null'})`,
        port,
        baseUrl: undefined,
        activeModelId: undefined,
        bundled: true,
        managedByApp: false,
      });
    });
    child.on('error', error => {
      console.warn('[Strata] process failed:', error);
      if (this.process !== child || generation !== this.generation) return;
      this.process = null;
      this.activeCatalogId = undefined;
      if (this.phase === 'stopping') return;
      this.phase = 'idle';
      this.setStatus({
        status: StrataServiceStatus.Error,
        error: error.message,
        port,
        baseUrl: undefined,
        activeModelId: undefined,
        bundled: true,
        managedByApp: false,
      });
    });
  }

  private async waitUntilHealthy(
    generation: number,
    child: ChildProcessWithoutNullStreams,
    port: number,
    catalogId: string,
    timeoutMs: number,
  ): Promise<void> {
    const client = new StrataClient(`http://127.0.0.1:${port}`);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (!this.isActiveStart(generation, child)) return;
      if (await client.health()) {
        if (!this.isActiveStart(generation, child)) return;
        this.activeCatalogId = catalogId;
        this.setStatus({
          status: StrataServiceStatus.Running,
          port,
          baseUrl: `http://127.0.0.1:${port}/v1`,
          activeModelId: catalogId,
          managedByApp: true,
          bundled: true,
          error: undefined,
        });
        return;
      }
      if (!this.isActiveStart(generation, child)) return;
      await new Promise(resolve => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
    }
    if (!this.isActiveStart(generation, child)) return;
    await this.failStart(generation, child, port, 'Strata did not become ready before timeout');
  }

  private async failStart(
    generation: number,
    child: ChildProcessWithoutNullStreams,
    port: number,
    message: string,
  ): Promise<void> {
    if (!this.isActiveStart(generation, child)) return;
    console.warn(`[Strata] ${message}`);
    // Own the terminal snapshot: the child's exit listener must not publish a
    // transient "exited before ready" error before the timeout result.
    this.phase = 'stopping';
    // Only the app-managed child is terminated; a manually started Strata on
    // the same port is never touched because it has no process handle here.
    await this.terminateChild(child);
    if (generation !== this.generation) return;
    this.process = null;
    this.phase = 'idle';
    this.setStatus({
      status: StrataServiceStatus.Error,
      error: message,
      port,
      baseUrl: undefined,
      activeModelId: undefined,
      bundled: true,
      managedByApp: false,
    });
  }

  private isActiveStart(generation: number, child: ChildProcessWithoutNullStreams): boolean {
    return generation === this.generation && this.process === child && this.phase === 'starting';
  }

  private async terminateCurrentProcess(): Promise<void> {
    const child = this.process;
    if (!child) return;
    await this.terminateChild(child);
  }

  private async terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (this.hasExited(child)) {
      if (this.process === child) this.process = null;
      return;
    }
    child.kill('SIGTERM');
    if (await this.waitForExit(child, STOP_GRACE_MS)) {
      if (this.process === child) this.process = null;
      return;
    }
    console.warn('[Strata] managed process ignored SIGTERM; forcing termination');
    child.kill('SIGKILL');
    if (await this.waitForExit(child, KILL_GRACE_MS)) {
      if (this.process === child) this.process = null;
      return;
    }
    console.error('[Strata] managed process did not exit after SIGKILL');
    if (this.process === child) this.process = null;
  }

  private hasExited(child: ChildProcessWithoutNullStreams): boolean {
    return child.exitCode !== null || child.signalCode !== null;
  }

  private waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
    if (this.hasExited(child)) return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
      let settled = false;
      const finish = (exited: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('exit', onExit);
        resolve(exited);
      };
      const onExit = (): void => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      child.once('exit', onExit);
    });
  }

  private setStatus(
    patch: Omit<Partial<StrataStatusSnapshot>, 'checkedAt'> & {
      status: StrataStatusSnapshot['status'];
    },
  ): void {
    const next: StrataStatusSnapshot = {
      ...this.status,
      ...patch,
      checkedAt: new Date().toISOString(),
    };
    const changed = !statusesEqual(this.status, next);
    this.status = next;
    // Emitting an unchanged snapshot would let status listeners re-probe the
    // service and feed a detect -> status -> detect loop.
    if (changed) this.emit('status', this.getStatus());
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
