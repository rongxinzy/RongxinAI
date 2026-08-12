import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

export class CcConnectSidecarManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startedAtMs: number | null = null;
  private lastErrorMessage: string | null = null;
  private controlUrl: string | null = null;
  constructor(private readonly executable: string, private readonly configPath: string) { super(); }
  get pid(): number | null { return this.child?.pid ?? null; }
  get startedAt(): number | null { return this.startedAtMs; }
  get lastError(): string | null { return this.lastErrorMessage; }
  get running(): boolean { return this.child !== null && this.child.exitCode === null; }
  async waitForControlUrl(timeoutMs = 10_000): Promise<string> {
    if (this.controlUrl) return this.controlUrl;
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('controlUrl', onControlUrl);
        reject(new Error('cc-connect control URL was not announced before timeout'));
      }, timeoutMs);
      const onControlUrl = (url: string) => {
        clearTimeout(timeout);
        resolve(url);
      };
      this.once('controlUrl', onControlUrl);
    });
  }
  async start(config: string): Promise<void> {
    if (this.child) return;
    if (!config.includes('bridge_url') || !config.includes('bridge_token')) {
      throw new Error('cc-connect sidecar config must contain bridge_url and bridge_token');
    }
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, config, { mode: 0o600 });
    // writeFile preserves an existing file's mode, so enforce it after every rotation.
    fs.chmodSync(this.configPath, 0o600);
    const child = spawn(this.executable, [], {
      env: { ...process.env, CC_CONNECT_CONFIG: this.configPath },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    this.startedAtMs = Date.now();
    this.lastErrorMessage = null;
    this.controlUrl = null;
    forwardLines(child.stdout, line => {
      this.captureControlUrl(line);
      this.emit('stdout', line);
    });
    forwardLines(child.stderr, line => {
      this.captureControlUrl(line);
      if (isErrorLogLine(line)) this.lastErrorMessage = line;
      this.emit('stderr', line);
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this.controlUrl = null;
      this.emit('exit', { code, signal });
    });
    child.on('error', error => {
      this.lastErrorMessage = error.message;
      this.emit('error', error);
    });
  }
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    await new Promise<void>(resolve => {
      const done = () => resolve();
      child.once('exit', done);
      // A process may already have exited between the null check and kill.
      if (!child.kill()) {
        child.off('exit', done);
        resolve();
      }
    });
  }

  private captureControlUrl(line: string): void {
    const match = line.match(/\burl=(http:\/\/[^\s]+)/);
    if (!match || !isLoopbackControlUrl(match[1]) || this.controlUrl === match[1]) return;
    this.controlUrl = match[1];
    this.emit('controlUrl', match[1]);
  }
}

function isLoopbackControlUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '::1' || url.hostname.startsWith('127.'));
  } catch {
    return false;
  }
}

function isErrorLogLine(line: string): boolean {
  return /(?:^|\s)(?:level=)?ERROR(?:\s|$)/.test(line);
}

function forwardLines(stream: NodeJS.ReadableStream, emit: (line: string) => void): void {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    pending += String(chunk);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) emit(line.trim());
  });
  stream.on('end', () => {
    if (pending.trim()) emit(pending.trim());
  });
}
