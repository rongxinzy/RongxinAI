import { fork, type ChildProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import type {
  PythonExecuteInput,
  PythonInstallInput,
  PythonExecutionResult,
  PythonRunnerRequest,
  PythonRunnerResponse,
  PythonPrepareInput,
  PythonPreparedEnvironment,
} from '../../shared/pythonRuntime';
import { PythonRuntimeOperation } from '../../shared/pythonRuntime/constants';
import { runtimeNetworkEnvironment } from './process';

const MAX_RUNNING_OPERATIONS = 2;
const MAX_WAITING_OPERATIONS = 64;
type QueuedOperation = {
  workspace: string;
  request: PythonRunnerRequest;
  queuedAt: number;
  signal?: AbortSignal;
  abort: () => void;
  resolve: (result: PythonExecutionResult) => void;
  reject: (error: unknown) => void;
};

/** Main process only schedules; downloads, package work and Python execute in a child Runner. */
export class PythonRuntimeService {
  private readonly active = new Set<ChildProcess>();
  private readonly queue: QueuedOperation[] = [];
  private readonly runningWorkspaces = new Set<string>();
  private closed = false;
  constructor(
    private readonly options: {
      storageRoot: string;
      runnerPath: string;
      jobRunnerPath?: string;
      /** Bundled interpreter/uv paths; flows to the runner with every request. */
      preinstalledRuntime?: PythonRunnerRequest['preinstalledRuntime'];
      /** Shared uv cache directory (work package G: one cache across stacks). */
      uvCacheDir?: string;
    },
  ) {}

  execute(input: PythonExecuteInput, signal?: AbortSignal): Promise<PythonExecutionResult> {
    return this.schedule(PythonRuntimeOperation.Execute, input, signal);
  }
  install(input: PythonInstallInput, signal?: AbortSignal): Promise<PythonExecutionResult> {
    return this.schedule(PythonRuntimeOperation.Install, input, signal);
  }

  async prepare(
    input: PythonPrepareInput,
    signal?: AbortSignal,
  ): Promise<PythonPreparedEnvironment> {
    const result = await this.schedule(PythonRuntimeOperation.Prepare, input, signal);
    if (result.exitCode !== 0)
      throw new Error(result.stderr || result.stdout || 'Python environment preparation failed.');
    if (!result.pythonPath)
      throw new Error('Python environment preparation did not return an interpreter.');
    return {
      pythonPath: result.pythonPath,
      environmentId: result.environmentId,
      runtimeId: result.runtimeId,
    };
  }

  private async schedule(
    operation: PythonRunnerRequest['operation'],
    input: PythonExecuteInput | PythonInstallInput | PythonPrepareInput,
    signal?: AbortSignal,
  ) {
    if (this.closed) throw new Error('Python runtime is shutting down.');
    signal?.throwIfAborted();
    const workspace = await realpath(input.workspace);
    if (this.closed) throw new Error('Python runtime is shutting down.');
    signal?.throwIfAborted();
    if (this.queue.length >= MAX_WAITING_OPERATIONS)
      throw new Error(
        'The Python operation queue is full. Wait for an active operation to finish.',
      );
    return new Promise<PythonExecutionResult>((resolve, reject) => {
      const item: QueuedOperation = {
        workspace: process.platform === 'win32' ? workspace.toLowerCase() : workspace,
        request: { operation, input: { ...input, workspace }, ...this.options },
        queuedAt: Date.now(),
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.queue.indexOf(item);
          if (index === -1) return;
          this.queue.splice(index, 1);
          signal?.removeEventListener('abort', item.abort);
          reject(signal?.reason ?? new Error('Python operation cancelled.'));
        },
      };
      this.queue.push(item);
      signal?.addEventListener('abort', item.abort, { once: true });
      if (signal?.aborted) item.abort();
      this.drain();
    });
  }

  private drain(): void {
    while (!this.closed && this.runningWorkspaces.size < MAX_RUNNING_OPERATIONS) {
      const index = this.queue.findIndex(item => !this.runningWorkspaces.has(item.workspace));
      if (index === -1) return;
      const [item] = this.queue.splice(index, 1);
      item.signal?.removeEventListener('abort', item.abort);
      this.runningWorkspaces.add(item.workspace);
      const startedAt = Date.now();
      void this.launch(item.request, item.signal)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.runningWorkspaces.delete(item.workspace);
          console.debug(
            `[PythonRuntime] ${item.request.operation} waited ${startedAt - item.queuedAt}ms and ran for ${Date.now() - startedAt}ms`,
          );
          this.drain();
        });
    }
  }

  private launch(
    request: PythonRunnerRequest,
    signal?: AbortSignal,
  ): Promise<PythonExecutionResult> {
    return new Promise((resolve, reject) => {
      const child = fork(this.options.runnerPath, [], {
        env: { ...runtimeNetworkEnvironment(this.options.storageRoot), ELECTRON_RUN_AS_NODE: '1' },
        execArgv: [],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      this.active.add(child);
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let diagnostics = '';
      child.stderr?.on('data', chunk => {
        if (diagnostics.length < 4000)
          diagnostics += String(chunk).slice(0, 4000 - diagnostics.length);
      });
      const abort = () => {
        if (child.connected) child.send({ cancel: true }, () => {});
        killTimer ??= setTimeout(() => child.kill(), 1500);
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const finish = (error?: Error, result?: PythonExecutionResult) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        if (killTimer) clearTimeout(killTimer);
        if (error) reject(error);
        else resolve(result!);
      };
      child.once('error', error => finish(error));
      child.on('message', (message: PythonRunnerResponse) => {
        if (message.success === true) finish(undefined, message.result);
        else finish(new Error(message.error));
      });
      child.once('exit', (code, sig) => {
        this.active.delete(child);
        finish(
          new Error(
            signal?.aborted
              ? 'Python operation cancelled.'
              : `Python Runner exited (${code ?? sig}): ${diagnostics}`,
          ),
        );
      });
      child.send(request, error => {
        if (error) finish(error);
      });
    });
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const item of this.queue.splice(0)) {
      item.signal?.removeEventListener('abort', item.abort);
      item.reject(new Error('Python runtime is shutting down.'));
    }
    await Promise.all(
      [...this.active].map(
        child =>
          new Promise<void>(resolve => {
            const timer = setTimeout(() => child.kill(), 1500);
            child.once('exit', () => {
              clearTimeout(timer);
              resolve();
            });
            if (child.connected) child.send({ cancel: true }, () => {});
            else child.kill();
          }),
      ),
    );
  }
}
