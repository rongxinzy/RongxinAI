import { access } from 'node:fs/promises';
import path from 'node:path';

import type { PythonPrepareInput } from '../../shared/pythonRuntime';
import { getPythonRuntimeService } from '../pythonRuntime/host';
import { getEnhancedEnv } from './coworkUtil';
import { WorkspaceSkillError, WorkspaceSkillStatus } from './skillWorkspacePython/constants';
import type {
  RunSkillScriptOptions,
  SkillScriptErrorCode,
  SkillScriptRunResult,
} from './skillRuntimeRunner';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 15 * 60_000;

export function applyWorkspaceSkillPythonEnvironment(
  env: Record<string, string | undefined>,
  pythonPath: string,
): void {
  const binDir = path.dirname(pythonPath);
  env.PATH = [binDir, env.PATH].filter(Boolean).join(path.delimiter);
  env.VIRTUAL_ENV = path.dirname(binDir);
  env.UV_PYTHON = pythonPath;
  env.ZHIYUAN_PYTHON_BIN = pythonPath;
  env.ZHIYUAN_SKILL_PYTHON_BIN = pythonPath;
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
}

async function workspaceInput(
  options: RunSkillScriptOptions,
  skillDir: string,
): Promise<PythonPrepareInput> {
  const requirementsPath = path.join(skillDir, 'requirements.txt');
  const hasRequirements = await access(requirementsPath).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  return {
    workspace: options.workspaceRoot,
    timeoutMs: Math.min(Math.max(options.timeoutMs || DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS),
    ...(hasRequirements
      ? {
          skill: {
            skillId: options.skillId,
            requirementsPath,
            confirmDependencyInstall: options.confirmDependencyInstall,
          },
        }
      : {}),
  };
}

function workspacePythonError(error: unknown): {
  errorCode: SkillScriptErrorCode;
  error: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const errorCode = /cancel|abort/i.test(message)
    ? WorkspaceSkillError.Aborted
    : /timed?\s*out|timeout/i.test(message)
      ? WorkspaceSkillError.TimedOut
      : /requirement|dependenc|manifest|lock|confirmDependencyInstall/i.test(message)
        ? WorkspaceSkillError.DependenciesUnavailable
        : /runtime|interpreter|bundled.*missing/i.test(message)
          ? WorkspaceSkillError.RuntimeUnavailable
          : WorkspaceSkillError.Failed;
  return { errorCode, error: message };
}

/** Resolve the same workspace interpreter used by native Python tools. */
export async function prepareWorkspaceSkillPython(
  options: RunSkillScriptOptions,
  skillDir: string,
): Promise<{ pythonPath: string } | { errorCode: SkillScriptErrorCode; error: string }> {
  try {
    const input = await workspaceInput(options, skillDir);
    return await getPythonRuntimeService().prepare(input, options.signal);
  } catch (error) {
    return workspacePythonError(error);
  }
}

/** Python scripts and dependency work stay in the supervised workspace Runner. */
export async function runWorkspaceSkillPython(
  options: RunSkillScriptOptions,
  scriptPath: string,
  skillDir: string,
  skillsRoot: string,
): Promise<SkillScriptRunResult> {
  const startedAt = Date.now();
  const base = {
    runtime: 'python' as const,
    command: 'python',
    args: [scriptPath, ...(options.args ?? [])],
    scriptPath,
  };
  try {
    options.signal?.throwIfAborted();
    const input = await workspaceInput(options, skillDir);
    let managedEnv: Record<string, string | undefined>;
    try {
      managedEnv = await getEnhancedEnv();
    } catch (error) {
      console.warn(
        `[SkillWorkspacePython] runtime environment preparation failed for ${options.skillId}:`,
        error,
      );
      managedEnv = { ...process.env };
    }
    const result = await getPythonRuntimeService().execute(
      {
        ...input,
        scriptPath,
        args: options.args ?? [],
        env: {
          ...managedEnv,
          ...options.envOverrides,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          SKILLS_ROOT: skillsRoot,
          ZHIYUAN_SKILLS_ROOT: skillsRoot,
        },
      },
      options.signal,
    );
    const ok = result.exitCode === 0;
    return {
      ...base,
      command: result.pythonPath ?? base.command,
      ok,
      status: ok ? WorkspaceSkillStatus.Completed : WorkspaceSkillStatus.Failed,
      errorCode: ok ? undefined : WorkspaceSkillError.Failed,
      error: ok ? undefined : `Skill script exited with code ${result.exitCode}.`,
      exitCode: result.exitCode,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      durationMs: Date.now() - startedAt,
      timedOut: false,
      stdoutTruncated: result.truncated,
      stderrTruncated: result.truncated,
    };
  } catch (error) {
    const failure = options.signal?.aborted
      ? { errorCode: WorkspaceSkillError.Aborted, error: 'Skill script was aborted.' }
      : workspacePythonError(error);
    return {
      ...base,
      ...failure,
      ok: false,
      status:
        failure.errorCode === WorkspaceSkillError.TimedOut
          ? WorkspaceSkillStatus.TimedOut
          : failure.errorCode === WorkspaceSkillError.Aborted
            ? WorkspaceSkillStatus.Aborted
            : failure.errorCode === WorkspaceSkillError.RuntimeUnavailable
              ? WorkspaceSkillStatus.RuntimeUnavailable
              : WorkspaceSkillStatus.Failed,
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: Date.now() - startedAt,
      timedOut: failure.errorCode === WorkspaceSkillError.TimedOut,
    };
  }
}
