import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { StringDecoder } from 'string_decoder';

import {
  getElectronNodeRuntimePath,
  getEnhancedEnv,
  getSkillsRoot,
  getGitBashResolutionErrorForPi,
  resolveGitBashPathForPi,
} from './coworkUtil';
import { appendPythonRuntimeToEnv, getManagedPythonExecutable } from './pythonRuntime';
import { findSkillPythonExecutable } from './skillPythonRuntime';
import {
  appendUvRuntimeToEnv,
  configureUvForManagedPython,
  findBundledUvExecutable,
} from './uvRuntime';

export type SkillScriptErrorCode =
  | 'SKILL_SCRIPT_NOT_FOUND'
  | 'SKILL_SCRIPT_OUTSIDE_ROOT'
  | 'SKILL_RUNTIME_UNAVAILABLE'
  | 'SKILL_SCRIPT_FAILED'
  | 'SKILL_SCRIPT_TIMEOUT'
  | 'SKILL_SCRIPT_ABORTED';

export type SkillScriptRuntime = 'python' | 'node' | 'bash' | 'powershell';

export type SkillScriptRunResult = {
  ok: boolean;
  status: 'completed' | 'failed' | 'runtime-unavailable' | 'not-found' | 'timed-out' | 'aborted';
  errorCode?: SkillScriptErrorCode;
  error?: string;
  runtime: SkillScriptRuntime | null;
  command: string | null;
  args: string[];
  scriptPath: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
};

export type RunSkillScriptOptions = {
  skillId: string;
  script: string;
  args?: string[];
  workspaceRoot: string;
  skillsRoot?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  envOverrides?: Record<string, string | undefined>;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 15 * 60_000;
const MAX_ARGUMENTS = 128;
const MAX_ARGUMENT_LENGTH = 16_384;
const MAX_CAPTURED_OUTPUT_BYTES = 1 * 1024 * 1024;

const trimOutput = (value: string): string => value.trim();

type CapturedOutput = {
  decoder: StringDecoder;
  parts: string[];
  capturedBytes: number;
  truncated: boolean;
  finalized: boolean;
  value: string;
};

const createCapturedOutput = (): CapturedOutput => ({
  decoder: new StringDecoder('utf8'),
  parts: [],
  capturedBytes: 0,
  truncated: false,
  finalized: false,
  value: '',
});

const appendCapturedOutput = (current: CapturedOutput, chunk: Buffer | string): void => {
  if (current.truncated) return;
  const remaining = MAX_CAPTURED_OUTPUT_BYTES - current.capturedBytes;
  if (remaining <= 0) {
    current.truncated = true;
    return;
  }
  const bytes = Buffer.from(chunk);
  const captured = bytes.byteLength <= remaining ? bytes : bytes.subarray(0, remaining);
  current.parts.push(current.decoder.write(captured));
  current.capturedBytes += captured.byteLength;
  if (captured.byteLength < bytes.byteLength) current.truncated = true;
};

const finalizeCapturedOutput = (current: CapturedOutput): string => {
  if (current.finalized) return current.value;
  if (!current.truncated) {
    current.parts.push(current.decoder.end());
  } else {
    // The byte cap may have ended in the middle of a UTF-8 sequence. Do not
    // flush the decoder because that would return a replacement character.
  }
  current.value = current.parts.join('');
  current.finalized = true;
  return current.value;
};

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

const resolveRealPathIfPossible = (value: string): string => {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
};

export function resolveSkillScriptPath(
  skillsRoot: string,
  skillId: string,
  script: string,
): { scriptPath: string; skillDir: string } | { errorCode: SkillScriptErrorCode; error: string } {
  const root = resolveRealPathIfPossible(path.resolve(skillsRoot));
  const normalizedSkillId = skillId.trim();
  const normalizedScript = script.trim();
  const skillDir = path.resolve(root, normalizedSkillId);
  const scriptPath = path.resolve(skillDir, normalizedScript);

  if (
    !normalizedSkillId ||
    !normalizedScript ||
    !isWithin(root, skillDir) ||
    !isWithin(skillDir, scriptPath)
  ) {
    return {
      errorCode: 'SKILL_SCRIPT_OUTSIDE_ROOT',
      error: 'Skill script must remain inside its selected skill directory.',
    };
  }

  const realSkillDir = resolveRealPathIfPossible(skillDir);
  const realScriptPath = resolveRealPathIfPossible(scriptPath);
  if (!isWithin(root, realSkillDir) || !isWithin(realSkillDir, realScriptPath)) {
    return {
      errorCode: 'SKILL_SCRIPT_OUTSIDE_ROOT',
      error: 'Skill script must remain inside its selected skill directory.',
    };
  }

  if (!fs.existsSync(scriptPath) || !fs.statSync(scriptPath).isFile()) {
    return {
      errorCode: 'SKILL_SCRIPT_NOT_FOUND',
      error: `Skill script not found: ${scriptPath}`,
    };
  }

  return { scriptPath, skillDir };
}

function resolveRuntime(
  scriptPath: string,
  skillDir: string,
):
  | {
      runtime: SkillScriptRuntime;
      command: string;
      prefixArgs: string[];
      env: Record<string, string>;
    }
  | { errorCode: SkillScriptErrorCode; error: string } {
  const extension = path.extname(scriptPath).toLowerCase();

  if (extension === '.py') {
    let executable: string | null = null;
    try {
      executable = getManagedPythonExecutable();
    } catch {
      executable = null;
    }
    const requirementsPath = path.join(skillDir, 'requirements.txt');
    const skillPythonExecutable = fs.existsSync(requirementsPath)
      ? findSkillPythonExecutable(path.basename(skillDir), requirementsPath)
      : null;
    executable = skillPythonExecutable || executable;
    if (!executable) {
      return {
        errorCode: 'SKILL_RUNTIME_UNAVAILABLE',
        error: 'The application-managed Python runtime is unavailable for this Skill.',
      };
    }
    if (fs.existsSync(requirementsPath) && !skillPythonExecutable) {
      let uvExecutable: string | null = null;
      try {
        uvExecutable = findBundledUvExecutable(process.platform === 'win32' ? 'uv.exe' : 'uv');
      } catch {
        uvExecutable = null;
      }
      if (!uvExecutable) {
        return {
          errorCode: 'SKILL_RUNTIME_UNAVAILABLE',
          error: 'The application-managed uv runtime is unavailable for this Skill dependency set.',
        };
      }
      return {
        runtime: 'python',
        command: uvExecutable,
        prefixArgs: [
          'run',
          '--no-project',
          '--with-requirements',
          requirementsPath,
          '--python',
          executable,
        ],
        env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      };
    }
    return {
      runtime: 'python',
      command: executable,
      prefixArgs: [],
      env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    };
  }

  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return {
      runtime: 'node',
      command: getElectronNodeRuntimePath(),
      prefixArgs: [],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
  }

  if (extension === '.sh') {
    const command =
      process.platform === 'win32'
        ? resolveGitBashPathForPi()
        : fs.existsSync('/bin/bash')
          ? '/bin/bash'
          : process.env.SHELL || 'bash';
    if (!command) {
      return {
        errorCode: 'SKILL_RUNTIME_UNAVAILABLE',
        error:
          'No healthy Git Bash runtime is available for this Skill script.' +
          (getGitBashResolutionErrorForPi() ? ` ${getGitBashResolutionErrorForPi()}` : ''),
      };
    }
    const requirementsPath = path.join(skillDir, 'requirements.txt');
    const skillPythonExecutable = fs.existsSync(requirementsPath)
      ? findSkillPythonExecutable(path.basename(skillDir), requirementsPath)
      : null;
    return {
      runtime: 'bash',
      command,
      prefixArgs: [],
      env: {
        ...(skillPythonExecutable ? { ZHIYUAN_SKILL_PYTHON_BIN: skillPythonExecutable } : {}),
        // DOCX preview uses the same managed Electron Node runtime as .mjs
        // Skills. This keeps preview self-contained on packaged POSIX builds,
        // where a user-installed `node` is not guaranteed to exist.
        ZHIYUAN_ELECTRON_PATH: getElectronNodeRuntimePath(),
      },
    };
  }

  if (extension === '.ps1') {
    if (process.platform !== 'win32') {
      return {
        errorCode: 'SKILL_RUNTIME_UNAVAILABLE',
        error: 'PowerShell Skill scripts are supported only on Windows.',
      };
    }
    return {
      runtime: 'powershell',
      command: 'powershell.exe',
      prefixArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
      env: {},
    };
  }

  return {
    errorCode: 'SKILL_RUNTIME_UNAVAILABLE',
    error: `Unsupported Skill script type: ${extension || '(no extension)'}.`,
  };
}

function invalidInputResult(
  scriptPath: string,
  errorCode: SkillScriptErrorCode,
  error: string,
): SkillScriptRunResult {
  return {
    ok: false,
    status:
      errorCode === 'SKILL_SCRIPT_NOT_FOUND' || errorCode === 'SKILL_SCRIPT_OUTSIDE_ROOT'
        ? 'not-found'
        : errorCode === 'SKILL_RUNTIME_UNAVAILABLE'
          ? 'runtime-unavailable'
          : 'failed',
    errorCode,
    error,
    runtime: null,
    command: null,
    args: [],
    scriptPath,
    exitCode: null,
    stdout: '',
    stderr: '',
    durationMs: 0,
    timedOut: false,
  };
}

export async function runManagedSkillScript(
  options: RunSkillScriptOptions,
): Promise<SkillScriptRunResult> {
  const skillsRoot = options.skillsRoot || getSkillsRoot();
  const resolved = resolveSkillScriptPath(skillsRoot, options.skillId, options.script);
  if ('errorCode' in resolved) {
    return invalidInputResult(
      path.resolve(skillsRoot, options.skillId, options.script),
      resolved.errorCode,
      resolved.error,
    );
  }

  const args = options.args || [];
  if (
    args.length > MAX_ARGUMENTS ||
    args.some(value => typeof value !== 'string' || value.length > MAX_ARGUMENT_LENGTH)
  ) {
    return invalidInputResult(
      resolved.scriptPath,
      'SKILL_SCRIPT_FAILED',
      `Skill script arguments exceed the supported limit (${MAX_ARGUMENTS} arguments, ${MAX_ARGUMENT_LENGTH} characters each).`,
    );
  }

  const runtime = resolveRuntime(resolved.scriptPath, resolved.skillDir);
  if ('errorCode' in runtime) {
    return invalidInputResult(resolved.scriptPath, runtime.errorCode, runtime.error);
  }

  const timeoutMs = Math.min(
    Math.max(options.timeoutMs || DEFAULT_TIMEOUT_MS, 1_000),
    MAX_TIMEOUT_MS,
  );
  let env: Record<string, string | undefined>;
  try {
    env = await getEnhancedEnv('local');
  } catch (error) {
    // Keep the direct runner usable in test harnesses and unusual embedded
    // launches where Electron has not populated resourcesPath yet. The
    // managed runtimes are still appended below; this fallback is not a
    // request to use user-installed Python or Node binaries.
    console.warn(
      '[skill-runtime] Falling back to process environment:',
      error instanceof Error ? error.message : String(error),
    );
    env = { ...process.env };
  }
  try {
    appendPythonRuntimeToEnv(env);
  } catch (error) {
    console.warn(
      '[skill-runtime] Managed Python environment was not appended:',
      error instanceof Error ? error.message : String(error),
    );
  }
  try {
    appendUvRuntimeToEnv(env);
    configureUvForManagedPython(env);
  } catch (error) {
    console.warn(
      '[skill-runtime] Managed uv environment was not appended:',
      error instanceof Error ? error.message : String(error),
    );
  }
  Object.assign(env, runtime.env, options.envOverrides || {});
  env.SKILLS_ROOT = skillsRoot;
  env.ZHIYUAN_SKILLS_ROOT = skillsRoot;

  const commandArgs = [...runtime.prefixArgs, resolved.scriptPath, ...args];
  const startedAt = Date.now();

  if (options.signal?.aborted) {
    return {
      ok: false,
      status: 'aborted',
      errorCode: 'SKILL_SCRIPT_ABORTED',
      error: 'Skill script was aborted before it started.',
      runtime: runtime.runtime,
      command: runtime.command,
      args: commandArgs,
      scriptPath: resolved.scriptPath,
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      timedOut: false,
    };
  }

  return await new Promise<SkillScriptRunResult>(resolve => {
    const stdout = createCapturedOutput();
    const stderr = createCapturedOutput();
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let forceKillTimer: NodeJS.Timeout | null = null;

    const child = spawn(runtime.command, commandArgs, {
      cwd: path.resolve(options.workspaceRoot),
      env: env as NodeJS.ProcessEnv,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: SkillScriptRunResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const stopChild = (): void => {
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      stopChild();
    }, timeoutMs);

    const onAbort = (): void => {
      if (settled) return;
      aborted = true;
      stopChild();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', chunk => {
      appendCapturedOutput(stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      appendCapturedOutput(stderr, chunk);
    });
    const capturedResult = (): {
      stdout: string;
      stderr: string;
      stdoutTruncated: boolean;
      stderrTruncated: boolean;
    } => {
      const stdoutText = finalizeCapturedOutput(stdout);
      const stderrText = finalizeCapturedOutput(stderr);
      return {
        stdout: trimOutput(stdoutText),
        stderr: trimOutput(stderrText),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      };
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener('abort', onAbort);
      const errorCode = timedOut
        ? 'SKILL_SCRIPT_TIMEOUT'
        : aborted
          ? 'SKILL_SCRIPT_ABORTED'
          : error.code === 'ENOENT'
            ? 'SKILL_RUNTIME_UNAVAILABLE'
            : 'SKILL_SCRIPT_FAILED';
      const output = capturedResult();
      finish({
        ok: false,
        status: timedOut ? 'timed-out' : aborted ? 'aborted' : 'failed',
        errorCode,
        error: error.message,
        runtime: runtime.runtime,
        command: runtime.command,
        args: commandArgs,
        scriptPath: resolved.scriptPath,
        exitCode: null,
        stdout: output.stdout,
        stderr: output.stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        stdoutTruncated: output.stdoutTruncated,
        stderrTruncated: output.stderrTruncated,
      });
    });
    child.on('close', exitCode => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener('abort', onAbort);
      const failed = timedOut || aborted || exitCode !== 0;
      const output = capturedResult();
      finish({
        ok: !failed,
        status: timedOut ? 'timed-out' : aborted ? 'aborted' : failed ? 'failed' : 'completed',
        errorCode: timedOut
          ? 'SKILL_SCRIPT_TIMEOUT'
          : aborted
            ? 'SKILL_SCRIPT_ABORTED'
            : failed
              ? 'SKILL_SCRIPT_FAILED'
              : undefined,
        error: timedOut
          ? `Skill script timed out after ${timeoutMs}ms.`
          : aborted
            ? 'Skill script was aborted.'
            : failed
              ? `Skill script exited with code ${exitCode ?? 'unknown'}.`
              : undefined,
        runtime: runtime.runtime,
        command: runtime.command,
        args: commandArgs,
        scriptPath: resolved.scriptPath,
        exitCode,
        stdout: output.stdout,
        stderr: output.stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        stdoutTruncated: output.stdoutTruncated,
        stderrTruncated: output.stderrTruncated,
      });
    });
  });
}
