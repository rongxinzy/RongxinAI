import http from 'node:http';

import type {
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { LlamaCppGatewayAccessMode } from '../../shared/llamacpp';
import { scanLocalGgufModels } from './llamacppModelCatalog';
import { createLlamaCppModelGateway, type LlamaCppModelGateway } from './llamacppModelGateway';
import {
  LlamaCppModelDaemonCommand,
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
  private lanToken: string | undefined;
  private controlServer: http.Server | null = null;
  private gateway: LlamaCppModelGateway | null = null;
  private readonly processes: LlamaCppModelProcessManager;
  private readonly logWriters = new Map<string, ReturnType<typeof createLlamaCppModelRuntimeLogWriter>>();
  private readonly residency: LlamaCppModelResidencyManager;

  constructor(private readonly bootstrap: LlamaCppModelDaemonBootstrap) {
    this.config = bootstrap.serviceConfig;
    this.lanToken = bootstrap.lanToken;
    this.processes = new LlamaCppModelProcessManager({
      getExecutablePath: async () => this.bootstrap.executablePath,
      getServiceConfig: () => this.config,
      startupTimeoutMs: () => Math.max(1, Number.parseInt(this.config.timeout ?? '120', 10) || 120) * 1000,
    });
    this.residency = new LlamaCppModelResidencyManager({
      getPolicy: () => undefined,
      unload: async modelName => await this.processes.stop(modelName),
    });
    this.processes.on(LlamaCppModelProcessEvent.Output, (event: LlamaCppModelProcessOutput) => {
      const writer = this.logWriters.get(event.modelName) ?? createLlamaCppModelRuntimeLogWriter({
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
    await this.startGateway();
    await new Promise<void>((resolve, reject) => {
      const server = http.createServer((request, response) => {
        void this.handleControlRequest(request, response).catch(error => {
          this.writeJson(response, 500, { success: false, error: toErrorMessage(error) });
        });
      });
      server.once('error', reject);
      server.listen(this.bootstrap.controlPort, '127.0.0.1', () => {
        this.controlServer = server;
        resolve();
      });
    });
  }

  async shutdown(): Promise<void> {
    await this.processes.stopAll();
    await this.gateway?.stop();
    this.gateway = null;
    if (this.controlServer) {
      const server = this.controlServer;
      this.controlServer = null;
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
  }

  private async handleControlRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== CONTROL_PATH || !this.isAuthorized(request)) {
      this.writeJson(response, 401, { success: false, error: 'Unauthorized daemon control request.' });
      return;
    }
    const input = await this.readJson(request);
    const result = await this.execute(input);
    this.writeJson(response, result.success ? 200 : 400, result);
  }

  private async execute(input: LlamaCppModelDaemonRequest): Promise<LlamaCppModelDaemonResponse> {
    try {
      switch (input.command) {
        case LlamaCppModelDaemonCommand.Status:
        case LlamaCppModelDaemonCommand.ListRunningModels:
          return { success: true, status: this.getStatus() };
        case LlamaCppModelDaemonCommand.EnsureModel:
          await this.ensureModel(input.input);
          return { success: true, status: this.getStatus() };
        case LlamaCppModelDaemonCommand.StopModel:
          await this.processes.stop(input.modelName);
          this.residency.markUnloaded(input.modelName);
          return { success: true, status: this.getStatus() };
        case LlamaCppModelDaemonCommand.StopAll:
          await this.processes.stopAll();
          return { success: true, status: this.getStatus() };
        case LlamaCppModelDaemonCommand.ApplyConfig:
          await this.applyConfig(input.serviceConfig, input.lanToken);
          return { success: true, status: this.getStatus() };
        case LlamaCppModelDaemonCommand.Shutdown:
          const result = { success: true, status: this.getStatus() } as const;
          void this.shutdown().finally(() => process.exit(0));
          return result;
      }
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  }

  private async ensureModel(input: LlamaCppModelLaunchInput): Promise<void> {
    const modelName = input.model.trim();
    const model = this.findModel(modelName);
    if (!model?.path) throw new Error(`Local model was not found: ${modelName}.`);
    await this.residency.ensureReady(modelName, async () => {
      this.logWriters.delete(modelName);
      await this.processes.ensureRunning({ ...input, model: modelName, modelPath: model.path });
    });
  }

  private findModel(modelName: string): LlamaCppModel | undefined {
    const modelsDir = this.config.modelsDir?.trim();
    if (!modelsDir) return undefined;
    return scanLocalGgufModels(modelsDir).find(
      model => model.name === modelName || model.id === modelName || model.model === modelName,
    );
  }

  private getStatus(): LlamaCppModelDaemonStatus {
    const gatewayBaseUrl = this.gateway?.baseUrl() ?? null;
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

  private async applyConfig(config: LlamaCppServiceConfig, lanToken?: string): Promise<void> {
    const shouldRestartGateway =
      this.config.port !== config.port ||
      this.config.gatewayAccessMode !== config.gatewayAccessMode ||
      this.config.listenHost !== config.listenHost;
    this.config = config;
    this.lanToken = lanToken;
    if (!shouldRestartGateway) return;
    await this.gateway?.stop();
    this.gateway = null;
    await this.startGateway();
  }

  private async startGateway(): Promise<void> {
    if (this.gateway) return;
    this.gateway = createLlamaCppModelGateway({
      acquireModel: async modelName => {
        const release = await this.residency.acquire(modelName, async () => {
          await this.ensureModel({ model: modelName });
        });
        const baseUrl = this.processes.getModelBaseUrl(modelName);
        if (!baseUrl) {
          release();
          throw new Error('Model process did not expose an upstream endpoint.');
        }
        return { baseUrl, release };
      },
      listModels: () => this.listRunningModels().map(model => ({ id: model.name })),
      getConfig: () => ({
        port: Number.parseInt(this.config.port ?? '8080', 10) || 8080,
        accessMode:
          this.config.gatewayAccessMode === LlamaCppGatewayAccessMode.Lan ||
          this.config.listenHost === '0.0.0.0'
            ? LlamaCppGatewayAccessMode.Lan
            : LlamaCppGatewayAccessMode.Local,
        ...(this.lanToken ? { lanToken: this.lanToken } : {}),
      }),
    });
    await this.gateway.start();
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
      if (length > MAX_CONTROL_BODY_BYTES) throw new Error('Daemon control request exceeds size limit.');
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
