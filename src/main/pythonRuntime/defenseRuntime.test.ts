import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import type { PythonRunnerRequest } from '../../shared/pythonRuntime';
import { PythonPackageIndexUrl } from '../libs/pythonPackageIndexes';
import {
  applyDefensePythonPackageEnvironment,
  DEFENSE_INDEX_ENV,
  readDefensePythonIndex,
} from './defensePackagePolicy';
import { runProcess } from './process';
import { runPythonOperation } from './runtime';

vi.mock('./process', async importOriginal => ({
  ...(await importOriginal<typeof import('./process')>()),
  runProcess: vi.fn(),
}));

const output = (stdout = '', exitCode = 0) => ({ stdout, stderr: '', exitCode, truncated: false });

test('seeds an offline workspace and preserves it when its only optional index fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'defense-python-'));
  const python = join(root, 'python');
  const uv = join(root, 'uv');
  const jobRunner = join(root, 'job-runner.exe');
  await Promise.all(
    [python, uv, jobRunner, join(root, 'requirements.txt')].map(file => writeFile(file, '')),
  );
  const index = 'https://pypi.intranet.example/simple/';
  const request: PythonRunnerRequest = {
    operation: 'execute',
    input: { workspace: root, code: 'print(42)' },
    storageRoot: root,
    jobRunnerPath: jobRunner,
    preinstalledRuntime: { pythonPath: python, uvPath: uv, runtimeId: 'bundled' },
    defensePackages: { wheelhouseRoot: root, indexUrl: index },
  };
  vi.mocked(runProcess).mockImplementation(async (_command, args) => {
    if (args[0] === 'venv') {
      const bin = join(args.at(-1)!, process.platform === 'win32' ? 'Scripts' : 'bin');
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, process.platform === 'win32' ? 'python.exe' : 'python'), '');
    }
    if (args[1] === 'freeze') return output('numpy==2.4.0\n');
    if (args.includes('example-addon==1.0')) return output('', 1);
    return output();
  });
  const signal = new AbortController().signal;
  try {
    const first = await runPythonOperation(request, signal);
    expect(first.exitCode).toBe(0);
    const installs = () =>
      vi
        .mocked(runProcess)
        .mock.calls.map(([, args]) => args)
        .filter(args => args[1] === 'install');
    expect(installs()).toEqual([
      expect.arrayContaining([
        '--offline',
        '--no-index',
        '--require-hashes',
        join(root, 'requirements.txt'),
      ]),
    ]);
    const failed = await runPythonOperation(
      {
        ...request,
        operation: 'install',
        input: { workspace: root, packages: ['example-addon==1.0'] },
      },
      signal,
    );
    expect(failed).toMatchObject({ exitCode: 1, environmentId: first.environmentId });
    expect(installs().slice(-2)).toEqual([
      expect.arrayContaining(['--offline', '--no-index', 'example-addon==1.0']),
      expect.arrayContaining(['--default-index', index, 'example-addon==1.0']),
    ]);
    expect(installs().flat()).not.toContain('https://pypi.org/simple');
    const last = await runPythonOperation(request, signal);
    expect(last.environmentId).toBe(first.environmentId);
    expect(installs()).toHaveLength(4);

    await writeFile(join(root, 'requirements.txt'), '# Updated offline package lock\n');
    await expect(runPythonOperation(request, signal)).rejects.toThrow('Explicitly rebuild');
    const rebuilt = await runPythonOperation(
      { ...request, operation: 'install', input: { workspace: root, packages: [], rebuild: true } },
      signal,
    );
    expect(rebuilt.runtimeId).not.toBe(first.runtimeId);
    expect(rebuilt.environmentId).not.toBe(first.environmentId);
    expect(rebuilt.exitCode).toBe(0);
  } finally {
    vi.mocked(runProcess).mockReset();
    await rm(root, { recursive: true, force: true });
  }
});

test('managed Skill package tools discard inherited indexes and use the deployment mirror or local wheels', () => {
  try {
    vi.stubEnv(DEFENSE_INDEX_ENV, undefined);
    const offline: NodeJS.ProcessEnv = {
      UV_INDEX: 'https://unexpected.example/simple',
      PIP_EXTRA_INDEX_URL: 'https://unexpected.example/simple',
      UV_CONFIG_FILE: '/etc/uv.toml',
      PIP_REQUIREMENT: '/etc/requirements.txt',
    };
    applyDefensePythonPackageEnvironment(offline, join(tmpdir(), 'directory with spaces'));
    expect(offline).toMatchObject({ UV_OFFLINE: '1', UV_NO_INDEX: '1', PIP_NO_INDEX: '1' });
    expect(offline.UV_FIND_LINKS).toMatch(/directory%20with%20spaces\/wheels$/);
    expect(offline.UV_INDEX).toBeUndefined();
    expect(offline.UV_CONFIG_FILE).toBeUndefined();
    expect(offline.PIP_EXTRA_INDEX_URL).toBeUndefined();
    expect(offline.PIP_REQUIREMENT).toBeUndefined();

    vi.stubEnv(DEFENSE_INDEX_ENV, 'https://pypi.intranet.example/simple/');
    applyDefensePythonPackageEnvironment(offline, tmpdir());
    expect(offline.UV_DEFAULT_INDEX).toBe('https://pypi.intranet.example/simple/');
    expect(offline.PIP_INDEX_URL).toBe(offline.UV_DEFAULT_INDEX);
    expect(offline.UV_OFFLINE).toBeUndefined();
    expect(offline.PIP_NO_INDEX).toBeUndefined();

    vi.stubEnv(DEFENSE_INDEX_ENV, 'https://user:secret@pypi.intranet.example/simple/');
    applyDefensePythonPackageEnvironment(offline, tmpdir());
    expect(offline.UV_DEFAULT_INDEX).toBeUndefined();
    expect(offline.UV_NO_INDEX).toBe('1');

    vi.stubEnv(DEFENSE_INDEX_ENV, 'https://pypi.rongxzyai.com./simple');
    applyDefensePythonPackageEnvironment(offline, tmpdir());
    expect(offline.UV_DEFAULT_INDEX).toBeUndefined();
    expect(offline.UV_NO_INDEX).toBe('1');
  } finally {
    vi.unstubAllEnvs();
  }
});

test('public indexes used by the standard edition cannot be set as the defense mirror', () => {
  for (const index of [...Object.values(PythonPackageIndexUrl), 'https://pypi.org./simple']) {
    expect(() => readDefensePythonIndex(index)).toThrow('internal HTTPS package index');
  }
});
