import http from 'node:http';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { LlamaCppBackendError } from '../../shared/llamacpp';

import type {
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { scanLocalGgufModels } from './llamacppModelCatalog';
import {
  createLlamaCppModelGateway,
  resolveLlamaCppGatewayPort,
  type LlamaCppModelGateway,
} from './llamacppModelGateway';
import {
  LlamaCppModelDaemonCommand,
  LLAMACPP_MODEL_DAEMON_HANDOFF,
  type LlamaCppModelDaemonBootstrap,
  type LlamaCppModelDaemonRequest,
  type LlamaCppModelDaemonResponse,
  type LlamaCppModelDaemonStatus,
} from './llamacppModelDaemonProtocol';
import {
  LlamaCppModelProcessEvent,
  LlamaCppModelProcessManager,
  type LlamaCppModelProcessOutput,
} from './llamacppModelProcessManager';
import { createLlamaCppModelRuntimeLogWriter } from './llamacppModelRuntimeLog';
import { LlamaCppModelResidencyManager } from './llamacppModelResidencyManager';

const CONTROL_PATH = '/control';
const MAX_CONTROL_BODY_BYTES = 1024 * 1024;

export class LlamaCppModelDaemonRuntime {
  private config: LlamaCppServiceConfig;
  private controlServer: http.Server | null = null;
  private readonly gateway: LlamaCppModelGateway;
  private readonly shutdownController = new AbortController();
  private readonly parentHandoff?: Promise<void>;
  private stopping?: Promise<void>;
  private readonly processes: LlamaCppModelProcessManager;
  private readonly logWriters = new Map<
    string,
    ReturnType<typeof createLlamaCppModelRuntimeLogWriter>
  >();
  private readonly residency: LlamaCppModelResidencyManager;

  constructor(
    private readonly bootstrap: LlamaCppModelDaemonBootstrap,
    parent?: Pick<NodeJS.Process, 'on' | 'once' | 'off' | 'exit'>,
  ) {
    this.config = bootstrap.serviceConfig;
    if (parent) {
      const signal = this.shutdownController.signal;
      this.parentHandoff = new Promise(resolve => {
        const release = () => {
          parent.off('message', onMessage);
          parent.off('disconnect', onDisconnect);
          signal.removeEventListener('abort', release);
          resolve();
        };
        const onMessage = (message: unknown) => {
          if (message === LLAMACPP_MODEL_DAEMON_HANDOFF) release();
        };
        const onDisconnect = () => {
          // No model processes can exist before handoff.
          if (bootstrap.serviceConfig.keepRunningOnAppQuit !== false) release();
          else parent.exit(0);
        };
        parent.on('message', onMessage);
        parent.once('disconnect', onDisconnect);
        signal.addEventListener('abort', release, { once: true });
      });
    }
    this.processes = new LlamaCppModelProcessManager({
      getExecutablePath: async () => this.bootstrap.executablePath,
      getServiceConfig: () => this.config,
      startupTimeoutMs: () =>
        Math.max(1, Number.parseInt(this.config.timeout ?? '120', 10) || 120) * 1000,
      shutdownSignal: this.shutdownController.signal,
    });
    this.residency = new LlamaCppModelResidencyManager({
      getPolicy: () => undefined,
      unload: async modelName => await this.processes.stop(modelName),
    });
    this.gateway = createLlamaCppModelGateway({
      shutdownSignal: this.shutdownController.signal,
      acquireModel: async modelName => {
        this.shutdownController.signal.throwIfAborted();
        const release = await this.residency.acquire(modelName, () =>
          this.loadModel({ model: modelName }),
        );
        const baseUrl = this.processes.getModelBaseUrl(modelName);
        if (!baseUrl) {
          release();
          throw new Error('Model process did not expose an upstream endpoint.');
        }
        return { baseUrl, release };
      },
      listModels: () => this.listRunningModels().map(model => ({ id: model.name })),
    });
    this.processes.on(LlamaCppModelProcessEvent.Output, (event: LlamaCppModelProcessOutput) => {
      const writer =
        this.logWriters.get(event.modelName) ??
        createLlamaCppModelRuntimeLogWriter({
          userDataPath: this.bootstrap.userDataPath,
          modelName: event.modelName,
        });
      this.logWriters.set(event.modelName, writer);
      void writer.append(event.text).catch(error => {
        console.warn('[LlamaCppDaemon] failed to append raw model output:', error);
      });
    });
    this.processes.on(LlamaCppModelProcessEvent.Exited, ({ modelName }: { modelName: string }) => {
      this.logWriters.delete(modelName);
      this.residency.markUnloaded(modelName);
    });
  }

  async start(): Promise<void> {
    this.shutdownController.signal.throwIfAborted();
    await this.gateway.start(resolveLlamaCppGatewayPort(this.config.port));
    this.shutdownController.signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const server = http.createServer((request, response) => {
        void this.handleControlRequest(request, response).catch(error => {
          this.writeJson(response, 500, { success: false, error: toErrorMessage(error) });
        });
      });
      server.once('error', reject);
      server.listen(this.bootstrap.controlPort, '127.0.0.1', () => {
        const { signal } = this.shutdownController;
        if (signal.aborted) {
          server.close(error => reject(error ?? signal.reason));
          return;
        }
        this.controlServer = server;
        resolve();
      });
    });
  }

  shutdown(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.shutdownController.abort(new Error('The local inference daemon is shutting down.'));
    this.stopping = this.stopRuntime();
    return this.stopping;
  }

  private async stopRuntime(): Promise<void> {
    const results = await Promise.allSettled([this.gateway.stop(), this.processes.stopAll()]);
    // The controller uses this port to wait for both the gateway and model processes.
    if (this.controlServer) {
      const server = this.controlServer;
      this.controlServer = null;
      const closed = await Promise.allSettled([
        new Promise<void>((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
      ]);
      results.push(...closed);
    }
    const failures = results.flatMap(result =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Failed to shut down local inference.');
  }

  private async handleControlRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    if (request.method !== 'POST' || request.url !== CONTROL_PATH || !this.isAuthorized(request)) {
      this.writeJson(response, 401, {
        success: false,
        error: 'Unauthorized daemon control request.',
      });
      return;
    }
    const input = await this.readJson(request);
    const result = await this.execute(input);
    this.writeJson(response, result.success ? 200 : 400, result);
    if (
      result.success &&
      (input.command === LlamaCppModelDaemonCommand.Shutdown ||
        input.command === LlamaCppModelDaemonCommand.ShutdownIfIdle)
    ) {
      void finished(response, { cleanup: true })
        .catch(() => {})
        .then(() => this.shutdown())
        .then(
          () => process.exit(0),
          error => {
            console.error('[LlamaCppDaemon] Failed to clean up local inference:', error);
            process.exit(1);
          },
        );
    }
  }

  private async execute(input: LlamaCppModelDaemonRequest): Promise<LlamaCppModelDaemonResponse> {
    try {
      if (
        input.command !== LlamaCppModelDaemonCommand.Status &&
        input.command !== LlamaCppModelDaemonCommand.ListRunningModels
      ) {
        this.shutdownController.signal.throwIfAborted();
      }
      switch (input.command) {
        case LlamaCppModelDaemonCommand.Status:
        case LlamaCppModelDaemonCommand.ListRunningModels:
          return { success: true, status: this.getStatus() };
        case LlamaCppModelDaemonCommand.EnsureModel:
          await this.residency.ensureReady(input.input.model, () => this.loadModel(input.input));
          return { success: true, status: this.getStatus() };
        case LlamaCppModelDaemonCommand.StopModel:
          await this.processes.stop(input.modelName);
          this.residency.markUnloaded(input.modelName);
          return { success: true, status: this.getStatus() };
        case LlamaCppModelDaemonCommand.DeleteModelFile: {
          const modelName = input.modelName.trim();
          const target = path.resolve(input.modelPath);
          await this.residency.withModelUnavailable(modelName, async () => {
            const model = this.findModel(modelName);
            if (!model?.path || path.resolve(model.path) !== target) {
              throw new Error('The model file is no longer in the active library.');
            }
            if (
              this.processes
                .list()
                .some(
                  process =>
                    process.modelName !== modelName && path.resolve(process.modelPath) === target,
                )
            )
              throw new Error('The model file is in use by another local model.');
            await this.processes.stop(modelName);
            this.residency.markUnloaded(modelName);
            await unlink(target);
          });
          return { success: true, status: this.getStatus() };
        }
        case LlamaCppModelDaemonCommand.StopAll:
          await this.processes.stopAll();
          return { success: true, status: this.getStatus() };
        case LlamaCppModelDaemonCommand.ApplyConfig:
          await this.applyConfig(input.serviceConfig);
          return { success: true, status: this.getStatus() };
        case LlamaCppModelDaemonCommand.Shutdown:
        case LlamaCppModelDaemonCommand.ShutdownIfIdle:
          if (
            input.command === LlamaCppModelDaemonCommand.ShutdownIfIdle &&
            (this.residency.hasActiveWork() || this.processes.list().length > 0)
          ) {
            throw new Error(LlamaCppBackendError.SwitchRequiresStoppedService);
          }
          return { success: true, status: this.getStatus() };
      }
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  }

  private async loadModel(input: LlamaCppModelLaunchInput): Promise<void> {
    await this.parentHandoff;
    this.shutdownController.signal.throwIfAborted();
    const modelName = input.model.trim();
    const model = this.findModel(modelName);
    if (!model?.path) throw new Error(`Local model was not found: ${modelName}.`);
    this.logWriters.delete(modelName);
    await this.processes.ensureRunning({ ...input, model: modelName, modelPath: model.path });
  }

  private findModel(modelName: string): LlamaCppModel | undefined {
    const modelsDir = this.config.modelsDir?.trim();
    if (!modelsDir) return undefined;
    return scanLocalGgufModels(modelsDir).find(
      model => model.name === modelName || model.id === modelName || model.model === modelName,
    );
  }

  private getStatus(): LlamaCppModelDaemonStatus {
    const gatewayBaseUrl = this.gateway.baseUrl();
    const status: LlamaCppStatusSnapshot = {
      status: gatewayBaseUrl ? 'running' : 'stopped',
      managedByApp: true,
      checkedAt: new Date().toISOString(),
    };
    const modelProcesses = this.processes.list().map(process => ({
      modelName: process.modelName,
      modelPath: process.modelPath,
      port: process.port,
    }));
    return {
      status,
      runningModels: this.listRunningModels(),
      modelProcesses,
      gatewayBaseUrl,
    };
  }

  private listRunningModels(): LlamaCppRunningModel[] {
    return this.processes.list().map(process => ({
      name: process.modelName,
      id: process.modelName,
      model: process.modelName,
      path: process.modelPath,
      status: 'loaded',
      ...(process.runtimeContextLength
        ? { runtime_context_length: process.runtimeContextLength }
        : {}),
    }));
  }

  private async applyConfig(config: LlamaCppServiceConfig): Promise<void> {
    this.shutdownController.signal.throwIfAborted();
    this.config = config;
    await this.gateway.start(resolveLlamaCppGatewayPort(config.port));
  }

  private isAuthorized(request: http.IncomingMessage): boolean {
    return request.headers.authorization === `Bearer ${this.bootstrap.controlToken}`;
  }

  private async readJson(request: http.IncomingMessage): Promise<LlamaCppModelDaemonRequest> {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > MAX_CONTROL_BODY_BYTES)
        throw new Error('Daemon control request exceeds size limit.');
      chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as LlamaCppModelDaemonRequest;
  }

  private writeJson(response: http.ServerResponse, status: number, body: unknown): void {
    if (response.writableEnded) return;
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(body));
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
