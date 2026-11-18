import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { assertWindowsJobRunnerAvailable, runtimeNetworkEnvironment, runProcess } from './process';
import {
  type PythonExecuteInput,
  type PythonExecutionResult,
  type PythonRunnerRequest,
} from '../../shared/pythonRuntime';
import { PythonRuntimeOperation } from '../../shared/pythonRuntime/constants';
import { seedPythonBaseline } from './baseline';
import { packageName, validatePackages, resolveSkillRequirements } from './requirements';
import {
  buildWorkspaceExecutionEnv,
  missingRequirements,
  requirementsSatisfied,
} from './workspaceExecution';

const standaloneEnvironmentId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

type PreinstalledRuntime = NonNullable<PythonRunnerRequest['preinstalledRuntime']>;

/**
 * The bundled managed runtime ships with the application (work package G);
 * there is no runtime download. Absolute paths only — the isolated
 * subprocess environment never carries the bundled roots on PATH.
 */
export async function resolvePreinstalledRuntime(
  request: PythonRunnerRequest,
): Promise<{ python: string; uv: string; runtimeId: string; sharedPython?: string }> {
  const preinstalled: PreinstalledRuntime | undefined = request.preinstalledRuntime;
  if (!preinstalled) {
    throw new Error(
      'The managed Python runtime is not bundled with this build. Reinstall the application.',
    );
  }
  for (const label of ['Python interpreter', 'uv'] as const) {
    const path = label === 'Python interpreter' ? preinstalled.pythonPath : preinstalled.uvPath;
    try {
      await access(path);
    } catch {
      throw new Error(`The bundled ${label} is missing (${path}). Reinstall the application.`);
    }
  }
  if (preinstalled.sharedPythonPath) {
    await access(preinstalled.sharedPythonPath);
  }
  return {
    python: preinstalled.pythonPath,
    uv: preinstalled.uvPath,
    runtimeId: preinstalled.runtimeId,
    ...(preinstalled.sharedPythonPath ? { sharedPython: preinstalled.sharedPythonPath } : {}),
  };
}

type EnvironmentRecord = {
  runtimeId: string;
  baselineId: string;
  environmentId: string;
  requirements: string[];
  skillLocks: Record<string, string>;
};
export async function runPythonOperation(
  request: PythonRunnerRequest,
  signal: AbortSignal,
): Promise<PythonExecutionResult> {
  const input = request.input;
  await assertWindowsJobRunnerAvailable(request.jobRunnerPath);
  const runtime = await resolvePreinstalledRuntime(request);
  if (input.runtimeId !== undefined && input.runtimeId !== runtime.runtimeId)
    throw new Error('Unsupported Python runtime version.');
  const workspace = await realpath(input.workspace);
  const isWindows = process.platform === 'win32';
  const storageRoot = resolve(request.storageRoot);
  const key = createHash('sha256')
    .update(isWindows ? workspace.toLowerCase() : workspace)
    .digest('hex');
  // The former empty environments remain untouched; new workspaces start with
  // the packaged dependency baseline and never load the old environment layout.
  const stateRoot = join(storageRoot, 'workspaces-v2', key);
  const currentFile = join(stateRoot, 'current.json');
  let current: EnvironmentRecord | undefined;
  try {
    current = JSON.parse(await readFile(currentFile, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (
    current &&
    (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(current.environmentId) ||
      typeof current.runtimeId !== 'string')
  )
    throw new Error('Invalid Python environment record.');
  if (current) {
    if (!Array.isArray(current.requirements) || current.requirements.length > 4096)
      throw new Error('Invalid Python environment requirements.');
    for (const requirement of current.requirements) validatePackages([requirement]);
  }
  const baselineManifest = runtime.sharedPython
    ? join(dirname(dirname(runtime.sharedPython)), 'runtime.json')
    : undefined;
  if (baselineManifest && (await stat(baselineManifest)).size > 1024 * 1024)
    throw new Error('The Python dependency baseline manifest is too large.');
  const baselineId = baselineManifest
    ? createHash('sha256')
        .update(await readFile(baselineManifest, { signal }))
        .digest('hex')
    : '';
  const skill = input.skill
    ? await resolveSkillRequirements(runtime.sharedPython ?? '', input.skill, signal)
    : undefined;
  const rebuild =
    request.operation === PythonRuntimeOperation.Install && 'rebuild' in input && input.rebuild;
  if (
    current &&
    (current.runtimeId !== runtime.runtimeId || current.baselineId !== baselineId) &&
    !rebuild
  )
    throw new Error(
      'Python runtime version changed. Explicitly rebuild this workspace environment before continuing.',
    );
  const packages =
    request.operation === PythonRuntimeOperation.Install && 'packages' in input
      ? validatePackages(input.packages)
      : [];
  if (request.operation === PythonRuntimeOperation.Install && packages.length === 0 && !rebuild)
    throw new Error('At least one package or an explicit rebuild is required.');
  if (
    request.operation === PythonRuntimeOperation.Execute &&
    !('scriptPath' in input && typeof input.scriptPath === 'string') &&
    (!('code' in input) || typeof input.code !== 'string' || input.code.length > 1024 * 1024)
  )
    throw new Error('Python code must be at most 1 MiB.');
  const uvCacheDir = request.uvCacheDir ?? join(storageRoot, 'uv-cache');
  const env = buildWorkspaceExecutionEnv(uvCacheDir, 'env' in input ? input.env : undefined);
  const networkEnv = runtimeNetworkEnvironment(uvCacheDir);
  const run = (cmd: string, args: string[]) =>
    runProcess(cmd, args, {
      cwd: workspace,
      env: cmd === runtime.uv ? networkEnv : env,
      signal,
      jobRunnerPath: request.jobRunnerPath,
    });
  // Keep Windows DLL paths short by storing venvs outside the workspace hash directory.
  const environmentRoot = (record: EnvironmentRecord) =>
    isWindows && standaloneEnvironmentId.test(record.environmentId)
      ? join(storageRoot, 'venvs', record.environmentId)
      : join(stateRoot, record.environmentId);
  const pythonIn = (record: EnvironmentRecord) =>
    join(environmentRoot(record), isWindows ? 'Scripts/python.exe' : 'bin/python');
  const skillRequirements = skill
    ? [
        ...skill.requirements,
        ...(skill.lock && current?.skillLocks?.[skill.skillId] !== skill.lock.sha256
          ? (skill.lockedRequirements ?? [])
          : []),
      ]
    : [];
  const needsSkillInstall =
    skill &&
    (!current || !(await requirementsSatisfied(pythonIn(current), skillRequirements, run)));
  if (
    needsSkillInstall &&
    skill?.confirmationPackages?.length &&
    !input.skill?.confirmDependencyInstall
  )
    throw new Error(
      `Skill dependencies require confirmation for ${skill.skillId}: ${skill.confirmationPackages.join(', ')}. Ask the user to confirm this download, then retry with confirmDependencyInstall=true.`,
    );
  let installOutput = { stdout: '', stderr: '', exitCode: 0, truncated: false };
  const install = request.operation === PythonRuntimeOperation.Install || needsSkillInstall;
  const relocate = isWindows && current && !standaloneEnvironmentId.test(current.environmentId);
  if (!current || install || relocate) {
    const candidate: EnvironmentRecord = {
      runtimeId: runtime.runtimeId,
      baselineId,
      environmentId: isWindows ? randomUUID() : `${runtime.runtimeId}-${randomUUID()}`,
      requirements: [],
      // An install can change dependencies of previously used Skills. Their
      // locks must be revalidated before reuse, even when packages were copied.
      skillLocks: relocate && !install ? (current.skillLocks ?? {}) : {},
    };
    const candidateRoot = environmentRoot(candidate);
    await mkdir(stateRoot, { recursive: true });
    if (isWindows) await mkdir(dirname(candidateRoot), { recursive: true });
    let committed = false;
    try {
      const created = await run(runtime.uv, [
        'venv',
        '--no-config',
        '--no-python-downloads',
        '--python',
        runtime.python,
        candidateRoot,
      ]);
      if (created.exitCode !== 0)
        throw new Error(`Unable to create Python environment: ${created.stderr}`);
      const sourcePython = current && !rebuild ? pythonIn(current) : runtime.sharedPython;
      if (sourcePython) {
        await seedPythonBaseline({ sourcePython, targetPython: pythonIn(candidate), run, signal });
      }
      const overridden = new Set(packages.map(packageName));
      const requested = rebuild
        ? [
            ...(current?.requirements ?? []).filter(
              requirement => !overridden.has(packageName(requirement)),
            ),
            ...packages,
          ]
        : packages;
      // The baseline already contains most frozen packages. Rebuilding must not
      // resolve or redownload those distributions just to restore a few extras.
      const desired = rebuild
        ? await missingRequirements(pythonIn(candidate), requested, run)
        : requested;
      if (desired.length) {
        const requestedFile = join(candidateRoot, 'workspace-requirements.txt');
        await writeFile(requestedFile, `${desired.join('\n')}\n`);
        installOutput = await run(runtime.uv, [
          'pip',
          'install',
          '--no-config',
          '--no-python-downloads',
          '--python',
          pythonIn(candidate),
          '--only-binary',
          ':all:',
          '--link-mode',
          'copy',
          '--requirement',
          requestedFile,
        ]);
        if (installOutput.exitCode !== 0)
          return {
            ...installOutput,
            runtimeId: runtime.runtimeId,
            environmentId: current?.environmentId ?? '',
          };
      }
      if (rebuild && !(await requirementsSatisfied(pythonIn(candidate), requested, run)))
        throw new Error('The rebuilt Python environment does not match its locked requirements.');
      if (skill && install) {
        if (skill.lock) {
          // Install a verified immutable snapshot, never a mutable requirements
          // path supplied by a model or changed after manifest verification.
          const lockPath = join(candidateRoot, 'skill-requirements.txt');
          await writeFile(lockPath, skill.lock.content);
          installOutput = await run(runtime.uv, [
            'pip',
            'install',
            '--no-config',
            '--no-python-downloads',
            '--python',
            pythonIn(candidate),
            '--only-binary',
            ':all:',
            '--link-mode',
            'copy',
            '--require-hashes',
            '--no-deps',
            '--requirement',
            lockPath,
          ]);
          if (installOutput.exitCode !== 0)
            return {
              ...installOutput,
              runtimeId: runtime.runtimeId,
              environmentId: current?.environmentId ?? '',
            };
          candidate.skillLocks[skill.skillId] = skill.lock.sha256;
        } else if (!(await requirementsSatisfied(pythonIn(candidate), skill.requirements, run))) {
          installOutput = await run(runtime.uv, [
            'pip',
            'install',
            '--no-config',
            '--no-python-downloads',
            '--python',
            pythonIn(candidate),
            '--only-binary',
            ':all:',
            '--link-mode',
            'copy',
            ...skill.requirements,
          ]);
          if (installOutput.exitCode !== 0)
            return {
              ...installOutput,
              runtimeId: runtime.runtimeId,
              environmentId: current?.environmentId ?? '',
            };
        }
        if (!(await requirementsSatisfied(pythonIn(candidate), skill.requirements, run)))
          throw new Error('Skill dependencies do not satisfy the declared requirements.');
      }
      const checked = await run(runtime.uv, [
        'pip',
        'check',
        '--no-config',
        '--python',
        pythonIn(candidate),
      ]);
      if (checked.exitCode !== 0)
        return {
          ...checked,
          runtimeId: runtime.runtimeId,
          environmentId: current?.environmentId ?? '',
        };
      const frozen = await run(runtime.uv, [
        'pip',
        'freeze',
        '--no-config',
        '--python',
        pythonIn(candidate),
      ]);
      if (frozen.exitCode !== 0)
        throw new Error(`Unable to record Python environment: ${frozen.stderr}`);
      // Freeze is host-generated and may exceed the model's 40-package limit.
      candidate.requirements = frozen.stdout.split(/\r?\n/).filter(Boolean);
      for (const requirement of candidate.requirements) validatePackages([requirement]);
      signal.throwIfAborted();
      const next = `${currentFile}.${randomUUID()}.tmp`;
      await writeFile(next, JSON.stringify(candidate));
      await rename(next, currentFile);
      current = candidate;
      committed = true;
    } finally {
      if (!committed) await rm(candidateRoot, { recursive: true, force: true });
    }
  }
  if (!current || !(await exists(pythonIn(current))))
    throw new Error('Python environment is missing. Rebuild it explicitly.');
  const result = {
    ...installOutput,
    runtimeId: runtime.runtimeId,
    environmentId: current.environmentId,
    pythonPath: pythonIn(current),
  };
  if (request.operation !== PythonRuntimeOperation.Execute) return result;
  env.VIRTUAL_ENV = environmentRoot(current);
  env.PATH = [dirname(pythonIn(current)), env.PATH]
    .filter(Boolean)
    .join(process.platform === 'win32' ? ';' : ':');
  env.UV_PYTHON = pythonIn(current);
  env.ZHIYUAN_PYTHON_BIN = pythonIn(current);
  env.ZHIYUAN_SKILL_PYTHON_BIN = pythonIn(current);
  const execution = input as PythonExecuteInput;
  // A host-validated Skill script keeps normal sibling imports, including in
  // nested Python processes. Ad-hoc code retains the existing safe-path policy.
  if (execution.scriptPath) delete env.PYTHONSAFEPATH;
  const args = execution.scriptPath
    ? ['-u', execution.scriptPath, ...(execution.args ?? [])]
    : ['-u', '-c', execution.code ?? ''];
  const executed = await run(pythonIn(current), args);
  return { ...result, ...executed };
}
