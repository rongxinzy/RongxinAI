import { fork, type ChildProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import type {
  PythonExecuteInput,
  PythonInstallInput,
  PythonExecutionResult,
  PythonRunnerRequest,
  PythonRunnerResponse,
} from '../../shared/pythonRuntime';
import { runtimeNetworkEnvironment } from './process';

/** Main process only schedules; downloads, package work and Python execute in a child Runner. */
export class PythonRuntimeService {
  private readonly active = new Set<ChildProcess>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private closed = false;
  constructor(
    private readonly options: { storageRoot: string; runnerPath: string; jobRunnerPath?: string },
  ) {}

  execute(input: PythonExecuteInput, signal?: AbortSignal): Promise<PythonExecutionResult> {
    return this.schedule('execute', input, signal);
  }
  install(input: PythonInstallInput, signal?: AbortSignal): Promise<PythonExecutionResult> {
    return this.schedule('install', input, signal);
  }

  private async schedule(
    operation: PythonRunnerRequest['operation'],
    input: PythonExecuteInput | PythonInstallInput,
    signal?: AbortSignal,
  ) {
    if (this.closed) throw new Error('Python runtime is shutting down.');
    signal?.throwIfAborted();
    const workspace = await realpath(input.workspace);
    const key = process.platform === 'win32' ? workspace.toLowerCase() : workspace;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(() => {
        if (this.closed) throw new Error('Python runtime is shutting down.');
        signal?.throwIfAborted();
        return this.launch({ operation, input: { ...input, workspace }, ...this.options }, signal);
      });
    this.queues.set(key, pending);
    void pending
      .finally(() => {
        if (this.queues.get(key) === pending) this.queues.delete(key);
      })
      .catch(() => {});
    return pending;
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
