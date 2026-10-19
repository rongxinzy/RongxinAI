import { spawn } from 'child_process';

import type { SkillScriptRunResult } from './types';

export const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

/**
 * Run a command and reject with stderr when it exits non-zero.
 */
export const runCommand = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => reject(error));
    child.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Command failed with exit code ${code}`));
    });
  });

export const runCommandCapture = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; shell?: boolean },
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      shell: options?.shell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    if (options?.timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        // 'close' only fires once the stdio pipes drain, and a grandchild that
        // inherited stdout (npm scripts, shell profiles) can hold them open
        // long after the kill. Settle now and drop our ends of the pipes.
        child.stdout?.destroy();
        child.stderr?.destroy();
        reject(new Error(`Command timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `Command failed with exit code ${code}`));
    });
  });

export const runScriptWithTimeout = (options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<SkillScriptRunResult> =>
  new Promise(resolve => {
    const startedAt = Date.now();
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    let forceKillTimer: NodeJS.Timeout | null = null;

    const settle = (result: SkillScriptRunResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 2000);
      // 'close' only fires once the stdio pipes drain, and a grandchild that
      // inherited stdout (npm scripts, shell profiles) can hold them open long
      // after the kill. Settle now with the partial output and drop our ends
      // of the pipes instead of waiting for the process tree to unwind.
      child.stdout?.destroy();
      child.stderr?.destroy();
      settle({
        success: false,
        exitCode: null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startedAt,
        timedOut: true,
        error: `Command timed out after ${options.timeoutMs}ms`,
      });
    }, options.timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      settle({
        success: false,
        exitCode: null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startedAt,
        timedOut,
        error: error.message,
        spawnErrorCode: error.code,
      });
    });

    child.on('close', exitCode => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      settle({
        success: !timedOut && exitCode === 0,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startedAt,
        timedOut,
        error: timedOut ? `Command timed out after ${options.timeoutMs}ms` : undefined,
      });
    });
  });
