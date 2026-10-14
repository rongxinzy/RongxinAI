import { execFile, spawn } from 'child_process';

/** Output kept for one npm step; large enough for an install log, small enough to hold in memory. */
const OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;

/** A cancelled npm invocation: the child and its descendants were killed. */
export class NpmCommandAbortedError extends Error {
  constructor(command: string) {
    super(`${command} was cancelled`);
    this.name = 'NpmCommandAbortedError';
  }
}

/** A failed npm invocation that keeps the output explaining it. */
export class NpmCommandError extends Error {
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, stdout: string, stderr: string) {
    super(message);
    this.name = 'NpmCommandError';
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/** Last non-empty lines of captured npm output, formatted for a log line. */
function npmOutputTail(output: string, maxLines = 12): string {
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0);
  if (lines.length === 0) return '';
  return `\n${lines.slice(-maxLines).join('\n')}`;
}

export interface NpmCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Aborting kills npm and everything it spawned, and is awaited before rejecting. */
  signal?: AbortSignal;
}

/**
 * Kills a command together with everything it spawned.
 *
 * `npm run build` runs a script that runs a compiler: killing npm alone leaves
 * the real work behind as an orphan. Windows needs taskkill's tree walk; on POSIX
 * the child leads its own process group, so one signal reaches the whole group.
 */
function killProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    return new Promise(resolve => {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () =>
        resolve(),
      );
    });
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  return Promise.resolve();
}

/**
 * Run a bundled npm command without blocking the main process, and without
 * leaving anything behind when the caller stops waiting.
 *
 * The web-search runtime installs and compiles itself on demand. Doing that with
 * `execFileSync` froze the UI for 12-17 s at every start, and `stdio: 'ignore'`
 * threw the failure away, so a broken runtime could not be diagnosed from the
 * logs. Failure carries npm's own output back to the caller for the same reason.
 */
export function runNpmCommand(
  command: string,
  args: string[],
  options: NpmCommandOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      // Own process group on POSIX so a cancellation can reach npm's children.
      detached: process.platform !== 'win32',
      windowsHide: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let pendingTreeKill: Promise<void> | null = null;
    const collect =
      (target: 'stdout' | 'stderr'): ((chunk: Buffer) => void) =>
      (chunk: Buffer): void => {
        const text = chunk.toString();
        const current = target === 'stdout' ? stdout : stderr;
        if (current.length >= OUTPUT_LIMIT_BYTES) return;
        const next = current + text.slice(0, OUTPUT_LIMIT_BYTES - current.length);
        if (target === 'stdout') stdout = next;
        else stderr = next;
      };
    child.stdout?.on('data', collect('stdout'));
    child.stderr?.on('data', collect('stderr'));

    child.once('error', error => {
      reject(
        new NpmCommandError(
          `${command} ${args.join(' ')} failed: ${error.message}`,
          stdout,
          stderr,
        ),
      );
    });

    child.once('close', async code => {
      if (options.signal?.aborted) {
        // Let the tree kill finish before reporting: a rejection that leaves a
        // compiler running is not a cancellation, and waiting for this child to
        // close is what makes the rejection mean "it is gone".
        const treeKill = pendingTreeKill;
        if (treeKill) {
          try {
            await treeKill;
          } catch {
            // A kill that failed must not turn a cancellation into an error.
          }
        }
        reject(new NpmCommandAbortedError(`${command} ${args.join(' ')}`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = npmOutputTail(stderr) || npmOutputTail(stdout);
      reject(
        new NpmCommandError(
          `${command} ${args.join(' ')} failed with exit code ${String(code)}${detail}`,
          stdout,
          stderr,
        ),
      );
    });

    const signal = options.signal;
    if (!signal) return;
    const onAbort = (): void => {
      if (child.pid) pendingTreeKill = killProcessTree(child.pid);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    child.once('close', () => signal.removeEventListener('abort', onAbort));
  });
}
