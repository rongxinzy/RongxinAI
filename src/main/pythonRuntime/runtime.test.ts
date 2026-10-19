import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { bundledRuntimeId } from './bundledRuntime';
import { resolvePreinstalledRuntime, validatePackages } from './runtime';
import { isolatedEnvironment, runProcess } from './process';
import type { PythonRunnerRequest } from '../../shared/pythonRuntime';

const requestWith = (preinstalled?: PythonRunnerRequest['preinstalledRuntime']) =>
  ({ preinstalledRuntime: preinstalled }) as PythonRunnerRequest;

test('the bundled runtime id pins the packaged interpreter and uv versions', () => {
  expect(bundledRuntimeId()).toBe('bundled-cpython-3.14.6-uv-0.11.32');
});

test('install arguments accept pinned registry names, never shell flags or external source URLs', () => {
  expect(validatePackages(['numpy==2.2.6', 'requests[socks]==2.32.3'])).toHaveLength(2);
  for (const p of [
    '--target=/tmp',
    'git+https://example.com/a',
    '/tmp/local',
    'numpy;rm -rf /',
    'numpy',
    'numpy>=2',
  ])
    expect(() => validatePackages([p])).toThrow('pinned');
});
test('subprocess environment does not forward application credentials or Python path injection', () => {
  process.env.ZHIYUAN_TEST_SECRET = 'no';
  process.env.PYTHONPATH = '/not-allowed';
  try {
    const env = isolatedEnvironment('/cache');
    expect(env.ZHIYUAN_TEST_SECRET).toBeUndefined();
    expect(env.PYTHONPATH).toBeUndefined();
    expect(env.UV_PYTHON_DOWNLOADS).toBe('never');
  } finally {
    delete process.env.ZHIYUAN_TEST_SECRET;
    delete process.env.PYTHONPATH;
  }
});
test('no-shell process returns both streams and the actual failure exit code', async () => {
  if (process.platform === 'win32') return;
  const result = await runProcess(
    process.execPath,
    ['-e', 'console.log("out");console.error("err");process.exit(7)'],
    {
      cwd: process.cwd(),
      env: isolatedEnvironment('/tmp/cache'),
      signal: new AbortController().signal,
    },
  );
  expect(result).toMatchObject({ stdout: 'out\n', stderr: 'err\n', exitCode: 7, truncated: false });
});

test('a build without the bundled runtime rejects operations with a reinstall hint', async () => {
  await expect(resolvePreinstalledRuntime(requestWith())).rejects.toThrow(
    'Reinstall the application',
  );
});

test('a missing bundled executable is named explicitly instead of falling back to a download', async () => {
  const root = await mkdtemp(join(tmpdir(), 'python-bundled-'));
  const pythonPath = join(root, 'python3');
  await writeFile(pythonPath, '', { mode: 0o755 });
  try {
    await expect(
      resolvePreinstalledRuntime(
        requestWith({ pythonPath, uvPath: join(root, 'uv'), runtimeId: bundledRuntimeId() }),
      ),
    ).rejects.toThrow('bundled uv is missing');
    await expect(
      resolvePreinstalledRuntime(
        requestWith({
          pythonPath: join(root, 'missing'),
          uvPath: join(root, 'uv'),
          runtimeId: bundledRuntimeId(),
        }),
      ),
    ).rejects.toThrow('bundled Python interpreter is missing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('present bundled executables resolve as absolute paths with their runtime id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'python-bundled-'));
  const pythonPath = join(root, 'python3');
  const uvPath = join(root, 'uv');
  await writeFile(pythonPath, '', { mode: 0o755 });
  await writeFile(uvPath, '', { mode: 0o755 });
  try {
    const runtime = await resolvePreinstalledRuntime(
      requestWith({ pythonPath, uvPath, runtimeId: bundledRuntimeId() }),
    );
    expect(runtime).toEqual({ python: pythonPath, uv: uvPath, runtimeId: bundledRuntimeId() });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
