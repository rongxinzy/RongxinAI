import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import * as pty from 'node-pty';

const DEFAULT_COLUMNS = 100;
const DEFAULT_ROWS = 30;

export interface AuthTerminalStartedEvent {
  id: string;
  profileId: string;
  methodId: string;
}

export interface AuthTerminalExitedEvent extends AuthTerminalStartedEvent {
  exitCode: number;
  signal?: number;
}

type ActiveTerminal = AuthTerminalStartedEvent & { terminal: pty.IPty };
type PtySpawner = typeof pty.spawn;

/** Runs ACP terminal authentication separately from the ACP JSON-RPC stdio connection. */
export class AuthTerminalService extends EventEmitter {
  private readonly terminals = new Map<string, ActiveTerminal>();

  constructor(private readonly spawnPty: PtySpawner = pty.spawn) {
    super();
  }

  start(input: {
    profileId: string;
    methodId: string;
    executable: string;
    baseArgs: string[];
    authArgs: string[];
    cwd: string;
    environment: Record<string, string | undefined>;
    authEnvironment?: Record<string, string>;
  }): AuthTerminalStartedEvent {
    const id = randomUUID();
    const started = { id, profileId: input.profileId, methodId: input.methodId };
    const environment = Object.fromEntries(
      Object.entries({ ...input.environment, ...input.authEnvironment }).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    const terminal = this.spawnPty(input.executable, [...input.baseArgs, ...input.authArgs], {
      name: 'xterm-256color',
      cols: DEFAULT_COLUMNS,
      rows: DEFAULT_ROWS,
      cwd: input.cwd,
      env: environment,
    });
    const active: ActiveTerminal = { ...started, terminal };
    this.terminals.set(id, active);
    terminal.onData(data => this.emit('data', { id, data }));
    terminal.onExit(({ exitCode, signal }) => {
      if (!this.terminals.delete(id)) return;
      this.emit('exit', { ...started, exitCode, signal } satisfies AuthTerminalExitedEvent);
    });
    return started;
  }

  write(id: string, data: string): void {
    const terminal = this.require(id);
    terminal.terminal.write(data);
  }

  resize(id: string, columns: number, rows: number): void {
    const terminal = this.require(id);
    terminal.terminal.resize(Math.max(1, columns), Math.max(1, rows));
  }

  cancel(id: string): void {
    this.require(id).terminal.kill();
  }

  dispose(): void {
    for (const terminal of this.terminals.values()) terminal.terminal.kill();
    this.terminals.clear();
  }

  private require(id: string): ActiveTerminal {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error('The authentication terminal is no longer active.');
    return terminal;
  }
}
