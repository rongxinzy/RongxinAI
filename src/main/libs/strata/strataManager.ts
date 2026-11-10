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
import { resolveStrataProcessCommand, watchStrataReady } from './strataProcess';

const START_TIMEOUT_MS = 120_000;
const PREPARE_TIMEOUT_MS = 60 * 60_000;
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
  private startGeneration = 0;
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
    if (this.process && this.status.status === StrataServiceStatus.Error) return this.status;
    const generation = this.generation;
    const child = this.process;
    const port = this.resolvePort();
    const healthy = await new StrataClient(`http://127.0.0.1:${port}`).health();
    if (generation !== this.generation || this.phase !== 'idle' || child !== this.process) {
      return this.status;
    }
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
    // Only the latest, uncancelled request can accept duplicate callers.
    if (
      this.startInFlight &&
      this.startCatalogId === input.catalogId &&
      this.startGeneration === this.generation
    ) {
      return this.startInFlight;
    }
    const previous = this.startInFlight;
    const cleanup = previous ? this.stop() : this.stopInFlight;
    const generation = ++this.generation;
    // Publish the new request before waiting for cleanup. A later A in an
    // A -> B -> A switch must replace queued B, not join the cancelled first A.
    const task = this.runQueuedStart(input, generation, previous, cleanup);
    this.startInFlight = task;
    this.startCatalogId = input.catalogId;
    this.startGeneration = generation;
    try {
      return await task;
    } finally {
      if (this.startInFlight === task) {
        this.startInFlight = null;
        this.startCatalogId = undefined;
      }
    }
  }

  private async runQueuedStart(
    input: StrataStartInput,
    generation: number,
    previous: Promise<StrataStatusSnapshot> | null,
    cleanup: Promise<StrataStatusSnapshot> | null,
  ): Promise<StrataStatusSnapshot> {
    if (cleanup) await cleanup;
    if (previous) await previous.catch(() => {});
    if (generation === this.generation) {
      const result = await this.runStart(input, generation);
      if (generation === this.generation) return result;
    }
    // A superseded caller must not report the newer request's success.
    return {
      ...this.getStatus(),
      status: StrataServiceStatus.Stopped,
      baseUrl: undefined,
      activeModelId: undefined,
      managedByApp: false,
      error: undefined,
    };
  }

  private async runStart(
    input: StrataStartInput,
    generation: number,
  ): Promise<StrataStatusSnapshot> {
    if (!this.isBundled()) {
      this.setStatus({ status: StrataServiceStatus.NotBundled, bundled: false });
      return this.status;
    }
    const entry = getStrataCatalogEntry(input.catalogId);
    if (!entry) {
      throw new Error(`Unknown Strata catalog id: ${input.catalogId}`);
    }

    const port = this.resolvePort();
    const healthy = await new StrataClient(`http://127.0.0.1:${port}`).health();
    if (generation !== this.generation) return this.status;
    if (
      this.phase === 'idle' &&
      this.status.status === StrataServiceStatus.Running &&
      healthy &&
      this.activeCatalogId === entry.id
    ) {
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

    if (this.process) {
      this.phase = 'stopping';
      const exited = await this.terminateChild(this.process);
      if (generation !== this.generation) return this.status;
      if (!exited) {
        this.reportUnconfirmedStop(port);
        return this.status;
      }
      this.phase = 'idle';
    }
    if (generation !== this.generation) return this.status;
    const bundledRoot = resolveStrataBundledRoot();
    const manifest = readStrataBundledManifest(bundledRoot);
    if (!bundledRoot || !manifest) {
      throw new Error('Strata bundled runtime is missing.');
    }

    const runtimeRoot = path.join(bundledRoot, manifest.runtimeRoot);
    const pythonExe = path.join(bundledRoot, manifest.pythonExecutable);
    const launcher = path.join(runtimeRoot, 'managed-launch.py');
    const componentsDir = path.join(bundledRoot, manifest.componentsRoot);
    if (!fs.existsSync(pythonExe)) {
      throw new Error(`Strata bundled Python runtime missing: ${pythonExe}`);
    }
    if (!fs.existsSync(launcher)) throw new Error('Strata managed launcher is missing.');
    await releaseGpuForStrata(this.getOrchestrator());
    if (generation !== this.generation) return this.status;

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
      launcher,
      '--family',
      entry.family,
      '--model',
      entry.modelLaunchId,
      '--port',
      String(port),
      '--yes',
      '--no-tui',
      '--access',
      'local',
      '--tune',
      'skip',
      '--save-preset',
      'zhiyuan-managed',
    ];

    const env = {
      ...process.env,
      STRATA_COMPONENTS_DIR: componentsDir,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    };

    try {
      const command = resolveStrataProcessCommand(pythonExe, args);
      const child = spawn(command.executable, command.args, {
        cwd: runtimeRoot,
        detached: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });
      this.process = child;
      this.attachProcessListeners(child, port);
      let readyModel: string | undefined;
      let servingAt: number | undefined;
      watchStrataReady(
        child.stdout,
        port,
        modelId => {
          readyModel = modelId;
        },
        () => {
          servingAt ??= Date.now();
        },
      );
      await this.waitUntilHealthy(generation, child, port, entry.id, () => ({
        readyModel,
        servingAt,
      }));
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
    // Even an already-running cleanup must cancel starts queued after it.
    this.generation++;
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
    if (!(await this.terminateChild(child))) {
      this.reportUnconfirmedStop(port);
      return this.status;
    }
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

  private attachProcessListeners(child: ChildProcessWithoutNullStreams, port: number): void {
    child.stdout.on('data', chunk => console.debug(`[Strata] ${chunk.toString().trim()}`));
    child.stderr.on('data', chunk => console.warn(`[Strata] ${chunk.toString().trim()}`));
    child.on('exit', (code, signal) => {
      console.log(
        `[Strata] process exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`,
      );
      // Requests may reuse this process; its identity outlives their generation.
      if (this.process !== child) return;
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
      if (this.process !== child) return;
      if (this.phase === 'stopping' && child.pid) return;
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
    getLaunchProgress: () => { readyModel?: string; servingAt?: number },
  ): Promise<void> {
    const client = new StrataClient(`http://127.0.0.1:${port}`);
    const startedAt = Date.now();
    while (true) {
      if (!this.isActiveStart(generation, child)) return;
      const { readyModel, servingAt } = getLaunchProgress();
      const elapsed = Date.now() - (servingAt ?? startedAt);
      if (elapsed >= (servingAt === undefined ? PREPARE_TIMEOUT_MS : START_TIMEOUT_MS)) break;
      if (
        readyModel &&
        (await client.health()) &&
        (await client.listModels()).some(model => model.id === readyModel)
      ) {
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
    const exited = await this.terminateChild(child);
    if (generation !== this.generation) return;
    if (!exited) {
      this.reportUnconfirmedStop(port, message);
      return;
    }
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

  private reportUnconfirmedStop(port: number, cause?: string): void {
    this.phase = 'idle';
    this.setStatus({
      status: StrataServiceStatus.Error,
      port,
      baseUrl: undefined,
      activeModelId: undefined,
      bundled: true,
      managedByApp: true,
      error: cause
        ? `${cause}. Strata process exit could not be confirmed.`
        : 'Strata process exit could not be confirmed.',
    });
  }

  private async terminateChild(child: ChildProcessWithoutNullStreams): Promise<boolean> {
    if (this.hasExited(child)) {
      if (this.process === child) this.process = null;
      return true;
    }
    child.kill('SIGTERM');
    if (await this.waitForExit(child, STOP_GRACE_MS)) {
      if (this.process === child) this.process = null;
      return true;
    }
    console.warn('[Strata] managed process ignored SIGTERM; forcing termination');
    child.kill('SIGKILL');
    if (await this.waitForExit(child, KILL_GRACE_MS)) {
      if (this.process === child) this.process = null;
      return true;
    }
    console.error('[Strata] managed process did not exit after SIGKILL');
    return false;
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
