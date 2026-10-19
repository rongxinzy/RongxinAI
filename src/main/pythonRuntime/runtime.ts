import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isolatedEnvironment, runtimeNetworkEnvironment, runProcess } from './process';
import type { PythonExecutionResult, PythonRunnerRequest } from '../../shared/pythonRuntime';

const REQUIREMENT =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_,.-]+\])?==[A-Za-z0-9][A-Za-z0-9.!+_-]*$/;
export function validatePackages(packages: unknown): string[] {
  if (
    !Array.isArray(packages) ||
    packages.length > 40 ||
    packages.some(p => typeof p !== 'string' || p.length > 200 || !REQUIREMENT.test(p))
  )
    throw new Error(
      'Use pinned PyPI requirements such as numpy==2.2.6; URLs, paths and command options are not accepted.',
    );
  return packages;
}
const packageName = (value: string) =>
  value
    .split(/[=\[]/)[0]
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
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
): Promise<{ python: string; uv: string; runtimeId: string }> {
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
  return {
    python: preinstalled.pythonPath,
    uv: preinstalled.uvPath,
    runtimeId: preinstalled.runtimeId,
  };
}

type EnvironmentRecord = { runtimeId: string; environmentId: string; requirements: string[] };
export async function runPythonOperation(
  request: PythonRunnerRequest,
  signal: AbortSignal,
): Promise<PythonExecutionResult> {
  const input = request.input;
  if (process.platform === 'win32') {
    if (!request.jobRunnerPath) throw new Error('The Windows Python Job Object helper is missing.');
    await access(request.jobRunnerPath);
  }
  const runtime = await resolvePreinstalledRuntime(request);
  if (input.runtimeId !== undefined && input.runtimeId !== runtime.runtimeId)
    throw new Error('Unsupported Python runtime version.');
  const workspace = await realpath(input.workspace);
  const key = createHash('sha256')
    .update(process.platform === 'win32' ? workspace.toLowerCase() : workspace)
    .digest('hex');
  const stateRoot = join(resolve(request.storageRoot), 'workspaces', key);
  const currentFile = join(stateRoot, 'current.json');
  let current: EnvironmentRecord | undefined;
  try {
    current = JSON.parse(await readFile(currentFile, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (
    current &&
    (!/^[a-zA-Z0-9._-]+$/.test(current.environmentId) || typeof current.runtimeId !== 'string')
  )
    throw new Error('Invalid Python environment record.');
  if (current) validatePackages(current.requirements);
  const rebuild = request.operation === 'install' && 'rebuild' in input && input.rebuild;
  if (current && current.runtimeId !== runtime.runtimeId && !rebuild)
    throw new Error(
      'Python runtime version changed. Explicitly rebuild this workspace environment before continuing.',
    );
  const packages =
    request.operation === 'install' && 'packages' in input ? validatePackages(input.packages) : [];
  if (request.operation === 'install' && packages.length === 0 && !rebuild)
    throw new Error('At least one pinned package or an explicit rebuild is required.');
  if (
    request.operation === 'execute' &&
    (!('code' in input) || typeof input.code !== 'string' || input.code.length > 1024 * 1024)
  )
    throw new Error('Python code must be at most 1 MiB.');
  const uvCacheDir = request.uvCacheDir ?? join(resolve(request.storageRoot), 'uv-cache');
  const env = isolatedEnvironment(uvCacheDir);
  const networkEnv = runtimeNetworkEnvironment(uvCacheDir);
  const run = (cmd: string, args: string[]) =>
    runProcess(cmd, args, {
      cwd: workspace,
      env: cmd === runtime.uv ? networkEnv : env,
      signal,
      jobRunnerPath: request.jobRunnerPath,
    });
  const pythonIn = (record: EnvironmentRecord) =>
    join(
      stateRoot,
      record.environmentId,
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
  let installOutput = { stdout: '', stderr: '', exitCode: 0, truncated: false };
  if (!current || request.operation === 'install') {
    const candidate: EnvironmentRecord = {
      runtimeId: runtime.runtimeId,
      environmentId: `${runtime.runtimeId}-${randomUUID()}`,
      requirements: [],
    };
    const candidateRoot = join(stateRoot, candidate.environmentId);
    await mkdir(stateRoot, { recursive: true });
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
      const overridden = new Set(packages.map(packageName));
      const desired = [
        ...(current?.requirements ?? []).filter(p => !overridden.has(packageName(p))),
        ...packages,
      ];
      if (desired.length) {
        installOutput = await run(runtime.uv, [
          'pip',
          'install',
          '--no-config',
          '--no-python-downloads',
          '--python',
          pythonIn(candidate),
          '--index-url',
          'https://pypi.org/simple',
          '--only-binary',
          ':all:',
          ...desired,
        ]);
        if (installOutput.exitCode !== 0)
          return {
            ...installOutput,
            runtimeId: runtime.runtimeId,
            environmentId: current?.environmentId ?? '',
          };
      }
      const frozen = await run(runtime.uv, [
        'pip',
        'freeze',
        '--no-config',
        '--python',
        pythonIn(candidate),
      ]);
      if (frozen.exitCode !== 0)
        throw new Error(`Unable to record Python environment: ${frozen.stderr}`);
      candidate.requirements = validatePackages(frozen.stdout.split(/\r?\n/).filter(Boolean));
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
  if (request.operation === 'install')
    return { ...installOutput, runtimeId: runtime.runtimeId, environmentId: current.environmentId };
  env.VIRTUAL_ENV = join(stateRoot, current.environmentId);
  const result = await run(pythonIn(current), ['-u', '-c', 'code' in input ? input.code : '']);
  return { ...result, runtimeId: runtime.runtimeId, environmentId: current.environmentId };
}
