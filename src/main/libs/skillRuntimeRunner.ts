import { spawn } from 'child_process';
import { terminateProcessTree } from './ownedProcessStop';
import fs from 'fs';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import { app } from 'electron';

import { getElectronNodeRuntimePath, getEnhancedEnv, getSkillsRoot } from './coworkUtil';
import { resolveBundledSkillsRoots } from './coworkEnv/skillsRoot';
import { searchAnySearchGateway } from './anysearchGateway';
import { t } from '../i18n';
import { appendPythonRuntimeToEnv } from './pythonRuntime';
import {
  applyWorkspaceSkillPythonEnvironment,
  prepareWorkspaceSkillPython,
  runWorkspaceSkillPython,
} from './skillWorkspacePython';
import { appendUvRuntimeToEnv, configureUvForManagedPython } from './uvRuntime';

export type SkillScriptErrorCode =
  | 'SKILL_SCRIPT_NOT_FOUND'
  | 'SKILL_SCRIPT_OUTSIDE_ROOT'
  | 'SKILL_RUNTIME_UNAVAILABLE'
  | 'SKILL_DEPENDENCIES_UNAVAILABLE'
  | 'SKILL_SCRIPT_FAILED'
  | 'SKILL_SCRIPT_TIMEOUT'
  | 'SKILL_SCRIPT_ABORTED';

type SkillScriptRuntime = 'python' | 'node' | 'bash' | 'powershell';

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
  /**
   * Set once the user agreed to a large on-demand dependency download. Small
   * deltas install automatically; large ones (CAD, scipy, playwright) ask first
   * because they can be hundreds of megabytes.
   */
  confirmDependencyInstall?: boolean;
};

export type ManagedSkillProcess = {
  pid: number | null;
  isRunning(): boolean;
  runtime: SkillScriptRuntime;
  command: string;
  args: string[];
  scriptPath: string;
  waitForOutput(
    ready: (stdout: string, stderr: string) => boolean,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string }>;
  stop(): Promise<void>;
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

const resolveRealPathIfPossible = (value: string): Promise<string> =>
  fs.promises.realpath(value).catch(() => value);

const pathExists = (value: string): Promise<boolean> =>
  fs.promises.access(value).then(
    () => true,
    () => false,
  );

export async function resolveSkillScriptPath(
  skillsRoot: string,
  skillId: string,
  script: string,
): Promise<
  { scriptPath: string; skillDir: string } | { errorCode: SkillScriptErrorCode; error: string }
> {
  const root = await resolveRealPathIfPossible(path.resolve(skillsRoot));
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

  const [realSkillDir, realScriptPath] = await Promise.all([
    resolveRealPathIfPossible(skillDir),
    resolveRealPathIfPossible(scriptPath),
  ]);
  if (!isWithin(root, realSkillDir) || !isWithin(realSkillDir, realScriptPath)) {
    return {
      errorCode: 'SKILL_SCRIPT_OUTSIDE_ROOT',
      error: 'Skill script must remain inside its selected skill directory.',
    };
  }

  if (!(await fs.promises.stat(scriptPath).catch((): null => null))?.isFile()) {
    return {
      errorCode: 'SKILL_SCRIPT_NOT_FOUND',
      error: `Skill script not found: ${scriptPath}`,
    };
  }

  return { scriptPath, skillDir };
}

async function resolveRuntime(
  scriptPath: string,
  skillDir: string,
  options: RunSkillScriptOptions,
): Promise<
  | {
      runtime: SkillScriptRuntime;
      command: string;
      prefixArgs: string[];
      env: Record<string, string>;
      pythonPath?: string;
    }
  | { errorCode: SkillScriptErrorCode; error: string }
> {
  const extension = path.extname(scriptPath).toLowerCase();

  if (extension === '.py') {
    const prepared = await prepareWorkspaceSkillPython(options, skillDir);
    if ('errorCode' in prepared) return prepared;
    return {
      runtime: 'python',
      command: prepared.pythonPath,
      pythonPath: prepared.pythonPath,
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
    if (process.platform === 'win32') {
      return {
        errorCode: 'SKILL_RUNTIME_UNAVAILABLE',
        error: 'Shell (.sh) Skill scripts are not supported on Windows; use .py, .mjs, or .ps1.',
      };
    }
    const requirementsPath = path.join(skillDir, 'requirements.txt');
    const [hasBash, hasRequirements] = await Promise.all([
      pathExists('/bin/bash'),
      pathExists(requirementsPath),
    ]);
    const command = hasBash ? '/bin/bash' : process.env.SHELL || 'bash';
    const preparedPython = hasRequirements
      ? await prepareWorkspaceSkillPython(options, skillDir)
      : null;
    if (preparedPython && 'errorCode' in preparedPython) return preparedPython;
    return {
      runtime: 'bash',
      command,
      pythonPath:
        preparedPython && 'pythonPath' in preparedPython ? preparedPython.pythonPath : undefined,
      prefixArgs: [],
      env: {
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
    const requirementsPath = path.join(skillDir, 'requirements.txt');
    const preparedPython = (await pathExists(requirementsPath))
      ? await prepareWorkspaceSkillPython(options, skillDir)
      : null;
    if (preparedPython && 'errorCode' in preparedPython) return preparedPython;
    return {
      runtime: 'powershell',
      command: 'powershell.exe',
      pythonPath:
        preparedPython && 'pythonPath' in preparedPython ? preparedPython.pythonPath : undefined,
      prefixArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
      env: {},
    };
  }

  return {
    errorCode: 'SKILL_RUNTIME_UNAVAILABLE',
    error: `Unsupported Skill script type: ${extension || '(no extension)'}.`,
  };
}

type PreparedSkillScript = {
  runtime: {
    runtime: SkillScriptRuntime;
    command: string;
    prefixArgs: string[];
    env: Record<string, string>;
  };
  scriptPath: string;
  commandArgs: string[];
  env: Record<string, string | undefined>;
};

type SkillInvocation = { skillsRoot: string; scriptPath: string; skillDir: string };

async function resolveSkillInvocation(
  options: RunSkillScriptOptions,
): Promise<SkillInvocation | { result: SkillScriptRunResult }> {
  const skillsRoot = options.skillsRoot || getSkillsRoot();
  const resolved = await resolveSkillScriptPath(skillsRoot, options.skillId, options.script);
  if ('errorCode' in resolved) {
    return {
      result: invalidInputResult(
        path.resolve(skillsRoot, options.skillId, options.script),
        resolved.errorCode,
        resolved.error,
      ),
    };
  }

  const args = options.args || [];
  if (
    args.length > MAX_ARGUMENTS ||
    args.some(value => typeof value !== 'string' || value.length > MAX_ARGUMENT_LENGTH)
  ) {
    return {
      result: invalidInputResult(
        resolved.scriptPath,
        'SKILL_SCRIPT_FAILED',
        `Skill script arguments exceed the supported limit (${MAX_ARGUMENTS} arguments, ${MAX_ARGUMENT_LENGTH} characters each).`,
      ),
    };
  }

  return { skillsRoot, ...resolved };
}

async function prepareSkillScript(
  options: RunSkillScriptOptions,
  resolved: SkillInvocation,
): Promise<PreparedSkillScript | { result: SkillScriptRunResult }> {
  const { skillsRoot } = resolved;
  const args = options.args ?? [];
  const runtime = await resolveRuntime(resolved.scriptPath, resolved.skillDir, options);
  if ('errorCode' in runtime) {
    return { result: invalidInputResult(resolved.scriptPath, runtime.errorCode, runtime.error) };
  }

  let env: Record<string, string | undefined>;
  try {
    env = await getEnhancedEnv();
  } catch (error) {
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
  if (runtime.pythonPath) {
    applyWorkspaceSkillPythonEnvironment(env, runtime.pythonPath);
  }
  env.SKILLS_ROOT = skillsRoot;
  env.ZHIYUAN_SKILLS_ROOT = skillsRoot;

  return {
    runtime,
    scriptPath: resolved.scriptPath,
    commandArgs: [...runtime.prefixArgs, resolved.scriptPath, ...args],
    env,
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

async function runManagedWebSearch(
  options: RunSkillScriptOptions,
  scriptPath: string,
  allowQueryFile: boolean,
): Promise<SkillScriptRunResult> {
  const startedAt = Date.now();
  const [queryArg = '', count = '10'] = options.args ?? [];
  const maxResults = Number(count);
  const timeout = AbortSignal.timeout(
    Math.trunc(Math.min(Math.max(1_000, options.timeoutMs || DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS)),
  );
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    let query = queryArg;
    if (allowQueryFile && queryArg.startsWith('@')) {
      const file = await fs.promises.open(
        path.resolve(options.workspaceRoot, queryArg.slice(1)),
        fs.constants.O_RDONLY | fs.constants.O_NONBLOCK,
      );
      try {
        if (!(await file.stat()).isFile()) throw new Error(t('webSearchInvalidInput'));
        const input = Buffer.alloc(MAX_ARGUMENT_LENGTH + 1);
        const { bytesRead } = await file.read(input, 0, input.length, 0);
        if (bytesRead > MAX_ARGUMENT_LENGTH) throw new Error(t('webSearchInvalidInput'));
        query = input.toString('utf8', 0, bytesRead);
      } finally {
        await file.close();
      }
    }
    const { results, total, elapsed } = await searchAnySearchGateway(query, maxResults, signal);
    const time = elapsed === undefined ? '' : `  \n**Time:** ${elapsed}ms`;
    const markdown = (value: string) =>
      value
        .replace(/[\[\]]/g, '\\$&')
        .replace(/\r?\n+/g, ' ')
        .trim();
    const sections = results.map(({ title, url, snippet }) =>
      [`## ${markdown(title)}`, `**URL:** [${url}](${url})`, markdown(snippet)]
        .filter(Boolean)
        .join('\n\n'),
    );
    return {
      ok: true,
      status: 'completed',
      runtime: 'node',
      command: null,
      args: [scriptPath, ...(options.args ?? [])],
      scriptPath,
      exitCode: 0,
      stdout: [`# Search Results: ${query}\n\n**Results:** ${total}${time}`, ...sections, '']
        .join('\n\n---\n\n')
        .trim(),
      stderr: '',
      durationMs: Date.now() - startedAt,
      timedOut: false,
    };
  } catch (error) {
    const interrupted = options.signal?.aborted
      ? 'aborted'
      : timeout.aborted
        ? 'timed-out'
        : undefined;
    const result = invalidInputResult(
      scriptPath,
      interrupted === 'aborted'
        ? 'SKILL_SCRIPT_ABORTED'
        : interrupted
          ? 'SKILL_SCRIPT_TIMEOUT'
          : 'SKILL_SCRIPT_FAILED',
      error instanceof Error ? error.message : String(error),
    );
    return {
      ...result,
      status: interrupted ?? result.status,
      durationMs: Date.now() - startedAt,
      timedOut: interrupted === 'timed-out',
    };
  }
}

const activeSkillScriptStops = new Set<() => Promise<void> | undefined>();
let skillScriptAdmissionClosed = false;

export async function shutdownManagedSkillScripts(): Promise<void> {
  skillScriptAdmissionClosed = true;
  await Promise.all([...activeSkillScriptStops].map(stop => stop()));
}

export async function runManagedSkillScript(
  options: RunSkillScriptOptions,
): Promise<SkillScriptRunResult> {
  const invocation = await resolveSkillInvocation(options);
  if ('result' in invocation) return invocation.result;
  if (options.signal?.aborted || skillScriptAdmissionClosed) {
    return {
      ...invalidInputResult(
        invocation.scriptPath,
        'SKILL_SCRIPT_ABORTED',
        'Skill script was aborted before it started.',
      ),
      status: 'aborted',
    };
  }
  if (options.skillId.trim() === 'web-search') {
    const root = path.resolve(invocation.skillsRoot);
    const script = path.relative(invocation.skillDir, invocation.scriptPath);
    const allowQueryFile = script === path.join('scripts', 'search.mjs');
    if (
      (allowQueryFile || script === path.join('scripts', 'anysearch-search.mjs')) &&
      (root === path.resolve(getSkillsRoot()) ||
        (app.isPackaged &&
          resolveBundledSkillsRoots().some(candidate => root === path.resolve(candidate))))
    ) {
      return runManagedWebSearch(options, invocation.scriptPath, allowQueryFile);
    }
  }
  if (path.extname(invocation.scriptPath).toLowerCase() === '.py') {
    return runWorkspaceSkillPython(
      options,
      invocation.scriptPath,
      invocation.skillDir,
      invocation.skillsRoot,
    );
  }
  const prepared = await prepareSkillScript(options, invocation);
  if ('result' in prepared) return prepared.result;
  const { runtime, scriptPath, commandArgs, env } = prepared;
  const timeoutMs = Math.min(
    Math.max(options.timeoutMs || DEFAULT_TIMEOUT_MS, 1_000),
    MAX_TIMEOUT_MS,
  );
  const startedAt = Date.now();

  if (options.signal?.aborted || skillScriptAdmissionClosed) {
    return {
      ok: false,
      status: 'aborted',
      errorCode: 'SKILL_SCRIPT_ABORTED',
      error: 'Skill script was aborted before it started.',
      runtime: runtime.runtime,
      command: runtime.command,
      args: commandArgs,
      scriptPath,
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
    let stopping: Promise<void> | undefined;

    const child = spawn(runtime.command, commandArgs, {
      cwd: path.resolve(options.workspaceRoot),
      env: env as NodeJS.ProcessEnv,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: SkillScriptRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      options.signal?.removeEventListener('abort', onAbort);
      activeSkillScriptStops.delete(onAbort);
      resolve(result);
    };

    const stopChild = (): Promise<void> => {
      if (stopping) return stopping;
      clearTimeout(timeoutTimer);
      stopping = terminateProcessTree(child)
        .catch(error => {
          console.warn('[SkillRuntime] Failed to stop script process tree:', error);
        })
        .finally(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finishExit(child.exitCode);
        });
      return stopping;
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      void stopChild();
    }, timeoutMs);

    const onAbort = (): Promise<void> | undefined => {
      if (settled || stopping) return stopping;
      aborted = true;
      return stopChild();
    };
    activeSkillScriptStops.add(onAbort);
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
      if (stopping) return;
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
        scriptPath,
        exitCode: null,
        stdout: output.stdout,
        stderr: output.stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        stdoutTruncated: output.stdoutTruncated,
        stderrTruncated: output.stderrTruncated,
      });
    });
    const finishExit = (exitCode: number | null): void => {
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
        scriptPath,
        exitCode,
        stdout: output.stdout,
        stderr: output.stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        stdoutTruncated: output.stdoutTruncated,
        stderrTruncated: output.stderrTruncated,
      });
    };
    child.on('close', exitCode => {
      if (!stopping) finishExit(exitCode);
    });
  });
}

/** Start a long-lived Skill process whose lifetime is managed by the caller. */
export async function startManagedSkillProcess(
  options: RunSkillScriptOptions,
): Promise<ManagedSkillProcess> {
  const invocation = await resolveSkillInvocation(options);
  const prepared =
    'result' in invocation ? invocation : await prepareSkillScript(options, invocation);
  if ('result' in prepared) {
    throw new Error(`${prepared.result.errorCode}: ${prepared.result.error}`);
  }
  if (options.signal?.aborted) throw new Error('Skill process was aborted before it started.');

  const child = spawn(prepared.runtime.command, prepared.commandArgs, {
    cwd: path.resolve(options.workspaceRoot),
    env: prepared.env as NodeJS.ProcessEnv,
    shell: false,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let closed = false;
  let stopping: Promise<void> | undefined;
  const waiters = new Set<{
    ready: (stdout: string, stderr: string) => boolean;
    resolve: (value: { stdout: string; stderr: string }) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  const notify = (): void => {
    for (const waiter of [...waiters]) {
      if (waiter.ready(stdout, stderr)) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    }
  };
  child.stdout?.on('data', chunk => {
    stdout = `${stdout}${String(chunk)}`.slice(-MAX_CAPTURED_OUTPUT_BYTES);
    notify();
  });
  child.stderr?.on('data', chunk => {
    stderr = `${stderr}${String(chunk)}`.slice(-MAX_CAPTURED_OUTPUT_BYTES);
    notify();
  });
  child.once('close', code => {
    closed = true;
    for (const waiter of [...waiters]) {
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.reject(
        new Error(`Managed Skill process exited before readiness (${code ?? 'unknown'}).`),
      );
    }
  });
  child.once('error', error => {
    closed = true;
    for (const waiter of [...waiters]) {
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.reject(error);
    }
  });

  return {
    pid: child.pid,
    isRunning: () => !closed && child.exitCode === null && child.signalCode === null,
    runtime: prepared.runtime.runtime,
    command: prepared.runtime.command,
    args: prepared.commandArgs,
    scriptPath: prepared.scriptPath,
    waitForOutput: (ready, timeoutMs) => {
      if (ready(stdout, stderr))
        return Promise.resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      if (closed)
        return Promise.reject(new Error('Managed Skill process exited before readiness.'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`Managed Skill process did not become ready within ${timeoutMs}ms.`));
        }, timeoutMs);
        const waiter = { ready, resolve, reject, timer };
        waiters.add(waiter);
      });
    },
    stop: () => (stopping ??= terminateProcessTree(child)),
  };
}
