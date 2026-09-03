import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process';

const ACP_REQUEST_TIMEOUT_MS = 5_000;
const MAX_STDOUT_LINE_BYTES = 10 * 1024 * 1024; // 10 MB — session load replays can exceed 1 MB
const MAX_RESTART_ATTEMPTS = 2;
const RESTART_DELAY_MS = 250;
/** Grace window for a killed agent process to exit before dispose() returns. */
const DISPOSE_EXIT_TIMEOUT_MS = 2_000;
const MAX_STDERR_CONTEXT_BYTES = 16 * 1024;

type ProcessTreeChild = Pick<ChildProcessWithoutNullStreams, 'pid' | 'kill'>;

interface ProcessTreeTerminationOptions {
  platform?: NodeJS.Platform;
  terminateWindowsTree?: (pid: number) => Promise<void>;
}

const terminateWindowsTree = async (pid: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, error =>
      error ? reject(error) : resolve(),
    );
  });
};

const terminateChild = (child: ProcessTreeChild): void => {
  try {
    child.kill('SIGTERM');
  } catch {
    // The process may have exited between the PID check and the signal.
  }
};

export const terminateProcessTree = async (
  child: ProcessTreeChild,
  options: ProcessTreeTerminationOptions = {},
): Promise<void> => {
  const pid = child.pid;
  if (!pid) return;

  if ((options.platform ?? process.platform) === 'win32') {
    try {
      await (options.terminateWindowsTree ?? terminateWindowsTree)(pid);
    } catch {
      terminateChild(child);
    }
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    terminateChild(child);
  }
};

export interface AcpConnectionLaunchOptions {
  executable: string;
  args: string[];
  cwd: string;
  environment: Record<string, string | undefined>;
}

type PendingRequest = {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
};

type JsonRpcRequestId = number | string;

type RequestHandler = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/**
 * Owns one ACP stdio process. It deliberately treats stdout as newline-delimited
 * JSON-RPC and keeps stderr diagnostic-only, so accidental diagnostic output can
 * never become protocol input.
 */
export class AcpConnectionSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private requestId = 0;
  private readonly pending = new Map<JsonRpcRequestId, PendingRequest>();
  private notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null =
    null;
  private requestHandler: RequestHandler | null = null;
  private launchOptions: AcpConnectionLaunchOptions | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private disposed = false;
  private connectionGeneration = 0;
  private stderrContext = '';

  get generation(): number {
    return this.connectionGeneration;
  }

  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void {
    this.notificationHandler = handler;
  }
  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  isRunning(): boolean {
    return this.child?.exitCode === null && this.child.stdin.writable;
  }

  async start(options: AcpConnectionLaunchOptions): Promise<void> {
    this.disposed = false;
    this.launchOptions = {
      ...options,
      args: [...options.args],
      environment: { ...options.environment },
    };
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      // A just-exited child's 'exit' event may still be queued; give the event
      // loop a turn before deciding the process is alive.
      await new Promise(resolve => setImmediate(resolve));
    }
    if (
      this.child &&
      (this.child.exitCode !== null ||
        this.child.signalCode !== null ||
        this.child.killed ||
        !this.child.stdin.writable)
    ) {
      const staleChild = this.child;
      this.child = null;
      await terminateProcessTree(staleChild);
    }
    if (this.child) return;
    this.restartAttempts = 0;
    await this.startProcess(this.launchOptions);
  }

  private async startProcess(options: AcpConnectionLaunchOptions): Promise<void> {
    const env = Object.fromEntries(
      Object.entries(options.environment).filter((entry): entry is [string, string] =>
        Boolean(entry[1]),
      ),
    );
    const isWindowsBatch =
      process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(options.executable);
    const child = spawn(
      isWindowsBatch ? process.env.ComSpec || 'cmd.exe' : options.executable,
      isWindowsBatch ? ['/d', '/s', '/c', options.executable, ...options.args] : options.args,
      {
        cwd: options.cwd,
        env,
        shell: false,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.child = child;
    this.connectionGeneration += 1;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.consumeStdout(String(chunk)));
    child.stderr.on('data', chunk => {
      const text = String(chunk);
      this.stderrContext = `${this.stderrContext}${text}`.slice(-MAX_STDERR_CONTEXT_BYTES);
      console.debug('[AcpConnection] agent stderr:', text);
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.failAll(new Error(`ACP agent exited (${code ?? signal ?? 'unknown'}).`));
      void terminateProcessTree(child).finally(() => this.scheduleRestart());
    });
    child.once('error', error => {
      if (this.child !== child) return;
      this.child = null;
      this.failAll(error);
      void terminateProcessTree(child).finally(() => this.scheduleRestart());
    });
  }

  async request<T>(
    method: string,
    params: Record<string, unknown>,
    options: { timeoutMs?: number | null } = {},
  ): Promise<T> {
    if (!this.child?.stdin.writable) throw new Error('ACP agent connection is not running.');
    const id = ++this.requestId;
    const response = new Promise<T>((resolve, reject) => {
      const timeoutMs =
        options.timeoutMs === undefined ? ACP_REQUEST_TIMEOUT_MS : options.timeoutMs;
      const timeout =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`ACP request timed out: ${method}.`));
            }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: value => resolve(value as T),
        reject,
        timeout,
      });
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return await response;
  }

  notify(method: string, params: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) throw new Error('ACP agent connection is not running.');
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.launchOptions = null;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    this.child = null;
    this.failAll(new Error('ACP agent connection was disposed.'));
    if (!child) return;
    await terminateProcessTree(child);
    if (child.exitCode !== null || child.signalCode !== null) return;
    // Wait for the process to actually exit: on Windows the agent keeps its
    // cwd (the workspace root) locked until it is gone.
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, DISPOSE_EXIT_TIMEOUT_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer) > MAX_STDOUT_LINE_BYTES) {
      this.failAll(new Error('ACP agent emitted an oversized stdout message.'));
      void this.dispose();
      return;
    }
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.consumeMessage(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private consumeMessage(line: string): void {
    try {
      const message = JSON.parse(line) as {
        id?: unknown;
        method?: unknown;
        params?: unknown;
        result?: unknown;
        error?: { code?: unknown; message?: unknown; data?: unknown };
      };
      if (typeof message.method === 'string') {
        const params = (message.params ?? {}) as Record<string, unknown>;
        if (typeof message.id === 'number' || typeof message.id === 'string') {
          void this.respondToAgentRequest(message.id, message.method, params);
        } else {
          this.notificationHandler?.(message.method, params);
        }
        return;
      }
      if (typeof message.id !== 'number' && typeof message.id !== 'string') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (pending.timeout) clearTimeout(pending.timeout);
      if (message.error) {
        const detail = String(message.error.message ?? 'ACP request failed.');
        const code =
          typeof message.error.code === 'number' || typeof message.error.code === 'string'
            ? ` (code ${message.error.code})`
            : '';
        const data =
          message.error.data && typeof message.error.data === 'object'
            ? ` Data: ${JSON.stringify(message.error.data).slice(0, 4000)}`
            : '';
        const context = this.stderrContext.trim();
        const suffix = context ? ` Agent diagnostics: ${context.slice(-2000)}` : '';
        pending.reject(new Error(`ACP request ${pending.method} failed${code}: ${detail}.${data}${suffix}`));
      }
      else pending.resolve(message.result);
    } catch (error) {
      console.warn('[AcpConnection] ignored malformed stdout protocol message:', error);
    }
  }

  private async respondToAgentRequest(
    id: JsonRpcRequestId,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      if (!this.requestHandler) throw new Error(`Unsupported ACP agent request: ${method}.`);
      const result = await this.requestHandler(method, params);
      this.writeMessage({ jsonrpc: '2.0', id, result });
    } catch (error) {
      this.writeMessage({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private writeMessage(message: Record<string, unknown>): void {
    if (this.child?.stdin.writable) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  private scheduleRestart(): void {
    if (
      this.disposed ||
      !this.launchOptions ||
      this.restartTimer ||
      this.restartAttempts >= MAX_RESTART_ATTEMPTS
    ) {
      return;
    }
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      const options = this.launchOptions;
      if (!options || this.disposed || this.child) return;
      void this.startProcess(options).catch(error => {
        console.warn('[AcpConnection] failed to restart the ACP agent:', error);
        this.scheduleRestart();
      });
    }, RESTART_DELAY_MS);
  }
}
