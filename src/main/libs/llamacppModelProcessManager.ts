import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import type { LlamaCppModelLaunchInput, LlamaCppServiceConfig } from '../../shared/llamacpp';
import { buildLlamaCppServeEnv, buildLlamaServerModelArgs } from './llamacppServe';
import { LlamaCppModelPortAllocator } from './llamacppModelPortAllocator';
import { stopOwnedProcess } from './ownedProcessStop';

const LOCAL_MODEL_HOST = '127.0.0.1';
const STARTUP_POLL_INTERVAL_MS = 250;

export const LlamaCppModelProcessEvent = {
  Output: 'output',
  Exited: 'exited',
} as const;

export type LlamaCppModelProcessOutput = {
  modelName: string;
  stream: 'stdout' | 'stderr';
  text: string;
  createdAt: string;
};

export type LlamaCppModelProcessSnapshot = {
  modelName: string;
  modelPath: string;
  port: number;
  baseUrl: string;
  runtimeContextLength?: number;
  pid?: number;
};

type ManagedModelProcess = LlamaCppModelProcessSnapshot & {
  child: ChildProcess;
  startup: Promise<LlamaCppModelProcessSnapshot>;
  stopping?: Promise<void>;
};

type LlamaCppModelProcessManagerOptions = {
  getExecutablePath: () => Promise<string | null>;
  getServiceConfig: () => LlamaCppServiceConfig;
  startupTimeoutMs: () => number;
  shutdownSignal?: AbortSignal;
};

export class LlamaCppModelProcessManager extends EventEmitter {
  private readonly portAllocator = new LlamaCppModelPortAllocator();
  private readonly processes = new Map<string, ManagedModelProcess>();

  constructor(private readonly options: LlamaCppModelProcessManagerOptions) {
    super();
  }

  getModelBaseUrl(modelName: string): string | null {
    return this.processes.get(modelName.trim())?.baseUrl ?? null;
  }

  list(): LlamaCppModelProcessSnapshot[] {
    return Array.from(this.processes.values()).map(
      ({
        child: _child,
        startup: _startup,
        stopping: _stopping,
        ...snapshot
      }): LlamaCppModelProcessSnapshot => snapshot,
    );
  }

  async ensureRunning(input: LlamaCppModelLaunchInput): Promise<LlamaCppModelProcessSnapshot> {
    const { shutdownSignal } = this.options;
    shutdownSignal?.throwIfAborted();
    const modelName = input.model.trim();
    const modelPath = input.modelPath?.trim();
    if (!modelName) throw new Error('Model name is required.');
    if (!modelPath) throw new Error(`Model path is required for ${modelName}.`);

    const existing = this.processes.get(modelName);
    if (existing?.stopping) {
      await existing.stopping;
      return await this.ensureRunning(input);
    }
    if (existing) return await existing.startup;

    const executablePath = await this.options.getExecutablePath();
    shutdownSignal?.throwIfAborted();
    if (!executablePath) throw new Error('llama.cpp runtime is not installed.');

    const lease = await this.portAllocator.reserve(modelName);
    if (shutdownSignal?.aborted) {
      this.portAllocator.release(modelName);
      shutdownSignal.throwIfAborted();
    }
    const config = this.options.getServiceConfig();
    const child = spawn(
      executablePath,
      buildLlamaServerModelArgs({ config, modelPath, port: lease.port, options: input.options }),
      {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildLlamaCppServeEnv(process.env, executablePath, process.platform),
        windowsHide: true,
      },
    );
    const snapshot: LlamaCppModelProcessSnapshot = {
      modelName,
      modelPath,
      port: lease.port,
      baseUrl: `http://${LOCAL_MODEL_HOST}:${lease.port}`,
      ...(child.pid ? { pid: child.pid } : {}),
    };
    const startup = this.waitUntilHealthy(snapshot, child);
    const record: ManagedModelProcess = { ...snapshot, child, startup };
    this.processes.set(modelName, record);
    this.subscribeToOutput(record);
    child.once('exit', (code, signal) => {
      if (this.processes.get(modelName) === record) {
        this.processes.delete(modelName);
        this.portAllocator.release(modelName);
      }
      this.emit(LlamaCppModelProcessEvent.Exited, { modelName, code, signal });
    });
    child.once('error', error => {
      this.emit(LlamaCppModelProcessEvent.Output, {
        modelName,
        stream: 'stderr',
        text: error.message,
        createdAt: new Date().toISOString(),
      } satisfies LlamaCppModelProcessOutput);
    });

    try {
      const ready = await startup;
      record.runtimeContextLength = ready.runtimeContextLength;
      return ready;
    } catch (error) {
      await this.stop(modelName).catch((): undefined => undefined);
      throw error;
    }
  }

  async stop(modelName: string): Promise<void> {
    const normalizedModelName = modelName.trim();
    const record = this.processes.get(normalizedModelName);
    if (!record) return;
    if (record.stopping) return await record.stopping;
    record.stopping = stopOwnedProcess(record.child)
      .then(() => {
        if (this.processes.get(normalizedModelName) === record) {
          this.processes.delete(normalizedModelName);
          this.portAllocator.release(normalizedModelName);
        }
      })
      .finally(() => {
        record.stopping = undefined;
      });
    await record.stopping;
  }

  async stopAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.processes.keys(), modelName => this.stop(modelName)),
    );
    const failures = results.flatMap(result =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Failed to stop local model processes.');
  }

  private subscribeToOutput(record: ManagedModelProcess): void {
    for (const [stream, output] of [
      ['stdout', record.child.stdout],
      ['stderr', record.child.stderr],
    ] as const) {
      output?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (!text) return;
        this.emit(LlamaCppModelProcessEvent.Output, {
          modelName: record.modelName,
          stream,
          text,
          createdAt: new Date().toISOString(),
        } satisfies LlamaCppModelProcessOutput);
      });
    }
  }

  private async waitUntilHealthy(
    snapshot: LlamaCppModelProcessSnapshot,
    child: ChildProcess,
  ): Promise<LlamaCppModelProcessSnapshot> {
    const deadline = Date.now() + this.options.startupTimeoutMs();
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Model process exited before becoming ready: ${snapshot.modelName}.`);
      }
      let healthy = false;
      try {
        healthy = (
          await fetch(`${snapshot.baseUrl}/health`, {
            signal: AbortSignal.timeout(500),
          })
        ).ok;
      } catch {
        // The process has not bound its local port yet.
      }
      if (healthy) {
        const propsResponse = await fetch(`${snapshot.baseUrl}/props`, {
          signal: AbortSignal.timeout(1000),
        });
        if (!propsResponse.ok) throw new Error('Model runtime properties are unavailable.');
        const props = (await propsResponse.json()) as {
          default_generation_settings?: { n_ctx?: unknown };
        };
        const actual = props?.default_generation_settings?.n_ctx;
        if (typeof actual !== 'number' || !Number.isSafeInteger(actual) || actual <= 0) {
          throw new Error('Model runtime did not report a valid context window.');
        }
        return { ...snapshot, runtimeContextLength: actual };
      }
      await new Promise(resolve => setTimeout(resolve, STARTUP_POLL_INTERVAL_MS));
    }
    throw new Error(`Model process did not become ready before timeout: ${snapshot.modelName}.`);
  }
}
