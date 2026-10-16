import { fork, spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';

export type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
};
const MAX_OUTPUT = 1024 * 1024;

/** No shell. Windows cannot execute without the real Job Object owner. */
export async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal: AbortSignal;
    jobRunnerPath?: string;
  },
): Promise<ProcessResult> {
  options.signal.throwIfAborted();
  if (process.platform === 'win32') {
    if (!options.jobRunnerPath) throw new Error('The Windows Python Job Object helper is missing.');
    await access(options.jobRunnerPath);
  }
  return new Promise((resolve, reject) => {
    const supervisorPath =
      process.platform !== 'win32' ? process.env.ZHIYUAN_PYTHON_RUNNER_ENTRY : undefined;
    const child = supervisorPath
      ? fork(supervisorPath, ['--python-process-supervisor'], {
          cwd: options.cwd,
          env: { ...options.env, ELECTRON_RUN_AS_NODE: '1' },
          execArgv: [],
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        })
      : spawn(
          process.platform === 'win32' ? options.jobRunnerPath! : command,
          process.platform === 'win32' ? [String(process.pid), command, ...args] : args,
          {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            windowsHide: true,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
    let supervisedExitCode: number | undefined;
    if (supervisorPath) {
      child.on('message', (message: { supervisedExitCode?: number }) => {
        if (typeof message.supervisedExitCode === 'number')
          supervisedExitCode = message.supervisedExitCode;
      });
      child.send?.({ command, args }, () => {});
    }
    let stdout = '',
      stderr = '',
      bytes = 0,
      truncated = false;
    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const available = Math.max(0, MAX_OUTPUT - bytes);
      bytes += chunk.length;
      if (chunk.length > available) truncated = true;
      const value = chunk.subarray(0, available).toString('utf8');
      if (target === 'stdout') stdout += value;
      else stderr += value;
    };
    child.stdout!.on('data', chunk => append('stdout', chunk));
    child.stderr!.on('data', chunk => append('stderr', chunk));
    const terminate = () => {
      if (!child.pid) return;
      if (supervisorPath) {
        if (child.connected) child.send?.({ cancel: true }, () => {});
        return;
      }
      try {
        if (process.platform === 'win32')
          child.kill(); // Closing the helper's handle kills its Job.
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    const abort = () => {
      terminate();
    };
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    child.once('exit', () => {
      if (process.platform !== 'win32') terminate();
    });
    child.once('error', error => {
      options.signal.removeEventListener('abort', abort);
      reject(error);
    });
    child.once('close', code => {
      options.signal.removeEventListener('abort', abort);
      // A completed script must not leave detached descendants running.
      terminate();
      if (options.signal.aborted)
        reject(options.signal.reason ?? new Error('Python execution cancelled.'));
      else resolve({ stdout, stderr, exitCode: supervisedExitCode ?? code ?? 1, truncated });
    });
  });
}

export function isolatedEnvironment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'Path',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'COMSPEC',
    'PATHEXT',
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    UV_CACHE_DIR: root,
    UV_NO_CONFIG: '1',
    UV_PYTHON_DOWNLOADS: 'never',
    UV_NO_PROGRESS: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONSAFEPATH: '1',
    PYTHONUTF8: '1',
  };
}

/** Network transport settings reach the trusted downloader/uv only, not user scripts. */
export function runtimeNetworkEnvironment(root: string): NodeJS.ProcessEnv {
  const env = isolatedEnvironment(root);
  for (const key of [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'NODE_EXTRA_CA_CERTS',
  ])
    if (process.env[key]) env[key] = process.env[key];
  env.NODE_USE_ENV_PROXY = '1';
  return env;
}

/** The supervisor survives a killed Runner and owns the command's process group. */
export function startPosixProcessSupervisor(): void {
  if (process.platform === 'win32') throw new Error('Windows must use its Job Object helper.');
  let command: ChildProcess | undefined;
  let started = false;
  let finished = false;
  const terminateGroup = () => {
    if (!command?.pid) return;
    try {
      process.kill(-command.pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  const finish = (code: number) => {
    if (finished) return;
    finished = true;
    terminateGroup();
    if (process.connected) process.send?.({ supervisedExitCode: code }, () => process.exit(0));
    else process.exit(0);
  };
  process.once('disconnect', () => finish(125));
  process.once('SIGTERM', () => finish(125));
  process.once('SIGINT', () => finish(125));
  process.on('message', (message: { cancel?: boolean; command?: string; args?: string[] }) => {
    if (message.cancel) {
      finish(125);
      return;
    }
    if (started || finished) return;
    started = true;
    if (typeof message.command !== 'string' || !Array.isArray(message.args)) {
      finish(125);
      return;
    }
    command = spawn(message.command, message.args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    command.once('error', () => finish(125));
    command.once('exit', code => finish(code ?? 1));
  });
}
