import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { x as extractTar } from 'tar';
import extractZip from 'extract-zip';
import manifest from './manifest.json';
import { isolatedEnvironment, runtimeNetworkEnvironment, runProcess } from './process';
import type { PythonExecutionResult, PythonRunnerRequest } from '../../shared/pythonRuntime';

export const PYTHON_RUNTIME_ID = manifest.id;
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

export async function downloadVerifiedAsset(
  asset: { url: string; sha256: string },
  file: string,
  signal: AbortSignal,
) {
  const response = await fetch(asset.url, { signal });
  if (!response.ok || !response.body)
    throw new Error(`Python runtime download failed (${response.status}).`);
  const hash = createHash('sha256');
  let size = 0;
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > 200 * 1024 * 1024) return callback(new Error('Runtime archive is too large.'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.from(
      (async function* () {
        const reader = response.body!.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            yield value;
          }
        } finally {
          reader.releaseLock();
        }
      })(),
    ),
    verifier,
    createWriteStream(file, { flags: 'wx' }),
    { signal },
  );
  if (hash.digest('hex') !== asset.sha256)
    throw new Error('Python runtime archive checksum mismatch.');
}

async function ensureRuntime(root: string, signal: AbortSignal) {
  const key = `${process.platform}-${process.arch}` as keyof typeof manifest.platforms;
  const target = manifest.platforms[key];
  if (!target) throw new Error(`Python runtime is not supported on ${key}.`);
  const directory = join(root, 'runtimes', manifest.id, key);
  const python = join(
    directory,
    'python',
    process.platform === 'win32' ? 'python.exe' : 'bin/python3',
  );
  const uvFolder = target.uv.archive.replace(/\.(tar\.gz|zip)$/, '');
  const uv = join(directory, ...(process.platform === 'win32' ? ['uv.exe'] : [uvFolder, 'uv']));
  if ((await exists(join(directory, 'ready.json'))) && (await exists(python)) && (await exists(uv)))
    return { python, uv };
  const staging = `${directory}.staging-${randomUUID()}`;
  await mkdir(staging, { recursive: true });
  try {
    for (const asset of [target.python, target.uv]) {
      signal.throwIfAborted();
      const file = join(staging, asset.archive);
      await downloadVerifiedAsset(asset, file, signal);
      if (asset.archive.endsWith('.zip')) await extractZip(file, { dir: staging });
      else await extractTar({ file, cwd: staging, strict: true, preservePaths: false });
      await rm(file);
    }
    signal.throwIfAborted();
    await writeFile(
      join(staging, 'ready.json'),
      JSON.stringify({ runtimeId: manifest.id, assets: target }),
    );
    await mkdir(resolve(directory, '..'), { recursive: true });
    try {
      await rename(staging, directory);
    } catch (error) {
      if (!(await exists(join(directory, 'ready.json')))) throw error;
    }
    if (!(await exists(python)) || !(await exists(uv)))
      throw new Error('The downloaded Python runtime is incomplete.');
    return { python, uv };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
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
  if (input.runtimeId !== undefined && input.runtimeId !== manifest.id)
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
  if (current && current.runtimeId !== manifest.id && !rebuild)
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
  const runtime = await ensureRuntime(resolve(request.storageRoot), signal);
  const env = isolatedEnvironment(join(resolve(request.storageRoot), 'uv-cache'));
  const networkEnv = runtimeNetworkEnvironment(join(resolve(request.storageRoot), 'uv-cache'));
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
      runtimeId: manifest.id,
      environmentId: `${manifest.id}-${randomUUID()}`,
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
            runtimeId: manifest.id,
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
    return { ...installOutput, runtimeId: manifest.id, environmentId: current.environmentId };
  env.VIRTUAL_ENV = join(stateRoot, current.environmentId);
  const result = await run(pythonIn(current), ['-u', '-c', 'code' in input ? input.code : '']);
  return { ...result, runtimeId: manifest.id, environmentId: current.environmentId };
}
