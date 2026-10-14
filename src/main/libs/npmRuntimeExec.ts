import { execFile } from 'child_process';

/** Output kept for one npm step; large enough for an install log, small enough to hold in memory. */
const OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;

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
  timeoutMs?: number;
}

/**
 * Run a bundled npm command without blocking the main process.
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
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: OUTPUT_LIMIT_BYTES,
        ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
        windowsHide: process.platform === 'win32',
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }
        const detail = npmOutputTail(stderr) || npmOutputTail(stdout);
        reject(
          new NpmCommandError(
            `${command} ${args.join(' ')} failed: ${error.message}${detail}`,
            stdout,
            stderr,
          ),
        );
      },
    );
  });
}
