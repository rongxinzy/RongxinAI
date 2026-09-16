import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import type { LlamaCppModelLaunchInput, LlamaCppServiceConfig } from '../../shared/llamacpp';
import { buildLlamaCppServeEnv, buildLlamaServerModelArgs } from './llamacppServe';
import { LlamaCppModelPortAllocator } from './llamacppModelPortAllocator';

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
};

type LlamaCppModelProcessManagerOptions = {
  getExecutablePath: () => Promise<string | null>;
  getServiceConfig: () => LlamaCppServiceConfig;
  startupTimeoutMs: () => number;
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
      ({ child: _child, startup: _startup, ...snapshot }): LlamaCppModelProcessSnapshot => snapshot,
    );
  }

  async ensureRunning(input: LlamaCppModelLaunchInput): Promise<LlamaCppModelProcessSnapshot> {
    const modelName = input.model.trim();
    const modelPath = input.modelPath?.trim();
    if (!modelName) throw new Error('Model name is required.');
    if (!modelPath) throw new Error(`Model path is required for ${modelName}.`);

    const existing = this.processes.get(modelName);
    if (existing) return await existing.startup;

    const executablePath = await this.options.getExecutablePath();
    if (!executablePath) throw new Error('llama.cpp runtime is not installed.');

    const lease = await this.portAllocator.reserve(modelName);
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
      ...(resolveRuntimeContextLength(input, config)
        ? { runtimeContextLength: resolveRuntimeContextLength(input, config) }
        : {}),
      ...(child.pid ? { pid: child.pid } : {}),
    };
    const startup = this.waitUntilHealthy(snapshot, child);
    const record: ManagedModelProcess = { ...snapshot, child, startup };
    this.processes.set(modelName, record);
    this.subscribeToOutput(record);
    child.once('exit', (code, signal) => {
      if (this.processes.get(modelName) === record) this.processes.delete(modelName);
      this.portAllocator.release(modelName);
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
      return await startup;
    } catch (error) {
      await this.stop(modelName).catch((): undefined => undefined);
      throw error;
    }
  }

  async stop(modelName: string): Promise<void> {
    const normalizedModelName = modelName.trim();
    const record = this.processes.get(normalizedModelName);
    if (!record) return;
    this.processes.delete(normalizedModelName);
    this.portAllocator.release(normalizedModelName);
    if (record.child.exitCode !== null || record.child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      record.child.once('exit', () => resolve());
      record.child.kill();
    });
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.processes.keys()).map(modelName => this.stop(modelName)));
    this.portAllocator.releaseAll();
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
      try {
        const response = await fetch(`${snapshot.baseUrl}/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) return snapshot;
      } catch {
        // The process has not bound its local port yet.
      }
      await new Promise(resolve => setTimeout(resolve, STARTUP_POLL_INTERVAL_MS));
    }
    throw new Error(`Model process did not become ready before timeout: ${snapshot.modelName}.`);
  }
}

function resolveRuntimeContextLength(
  input: LlamaCppModelLaunchInput,
  config: LlamaCppServiceConfig,
): number | undefined {
  const configured = input.options?.ctxSize ?? Number.parseInt(config.ctxSize ?? '', 10);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : undefined;
}
