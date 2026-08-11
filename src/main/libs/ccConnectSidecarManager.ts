import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

export class CcConnectSidecarManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  constructor(private readonly executable: string, private readonly configPath: string) { super(); }
  async start(config: string): Promise<void> {
    if (this.child) return;
    if (!config.includes('bridge_url') || !config.includes('bridge_token')) {
      throw new Error('cc-connect sidecar config must contain bridge_url and bridge_token');
    }
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, config, { mode: 0o600 });
    // writeFile preserves an existing file's mode, so enforce it after every rotation.
    fs.chmodSync(this.configPath, 0o600);
    this.child = spawn(this.executable, [], { env: { ...process.env, CC_CONNECT_CONFIG: this.configPath }, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child.on('exit', (code, signal) => { this.child = null; this.emit('exit', { code, signal }); });
    this.child.on('error', error => this.emit('error', error));
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
}
