import { randomUUID } from 'crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

const MAX_OUTPUT_BYTES = 1_048_576;

const utf8Tail = (buffer: Buffer, byteLimit: number): Buffer => {
  if (byteLimit <= 0) return Buffer.alloc(0);
  const tail = buffer.subarray(Math.max(0, buffer.length - byteLimit));
  let start = 0;
  while (start < tail.length && (tail[start] & 0xc0) === 0x80) start += 1;
  return tail.subarray(start);
};

export interface CodingTerminalResult {
  id: string;
  output: string;
  truncated: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

type ActiveTerminal = {
  child: ChildProcessWithoutNullStreams;
  result: CodingTerminalResult;
  completed: Promise<CodingTerminalResult>;
};

/** Executes non-interactive ACP terminal commands with bounded captured output. */
export class TerminalBroker {
  private readonly terminals = new Map<string, ActiveTerminal>();

  async run(input: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    outputByteLimit?: number;
  }): Promise<CodingTerminalResult> {
    const terminal = this.start(input);
    return await this.wait(terminal.id);
  }

  start(input: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    outputByteLimit?: number;
  }): CodingTerminalResult {
    const id = randomUUID();
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result: CodingTerminalResult = {
      id,
      output: '',
      truncated: false,
      exitCode: null,
      signal: null,
    };
    const outputByteLimit = Math.max(
      0,
      Math.min(Math.floor(input.outputByteLimit ?? MAX_OUTPUT_BYTES), MAX_OUTPUT_BYTES),
    );
    const append = (chunk: Buffer) => {
      const next = Buffer.concat([Buffer.from(result.output), chunk]);
      if (next.length > outputByteLimit) {
        result.output = utf8Tail(next, outputByteLimit).toString('utf8');
        result.truncated = true;
        return;
      }
      result.output = next.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const completed = new Promise<CodingTerminalResult>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        result.exitCode = code;
        result.signal = signal;
        resolve(result);
      });
    });
    this.terminals.set(id, { child, result, completed });
    return result;
  }

  output(id: string): CodingTerminalResult | null {
    return this.terminals.get(id)?.result ?? null;
  }

  async wait(id: string): Promise<CodingTerminalResult> {
    const active = this.terminals.get(id);
    if (!active) throw new Error('The ACP terminal was not found.');
    return await active.completed;
  }

  kill(id: string): boolean {
    const active = this.terminals.get(id);
    return active?.child.kill() ?? false;
  }
  release(id: string): void {
    this.terminals.delete(id);
  }

  dispose(): void {
    for (const { child } of this.terminals.values()) {
      if (!child.killed) child.kill();
    }
    this.terminals.clear();
  }
}
