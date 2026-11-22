import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { runManagedSkillScript, startManagedSkillProcess } from './skillRuntimeRunner';
import { WorkspaceSkillError, WorkspaceSkillStatus } from './skillWorkspacePython/constants';

const service = vi.hoisted(() => ({ execute: vi.fn(), prepare: vi.fn() }));
const enhancedEnv = vi.hoisted(() => vi.fn());
vi.mock('../pythonRuntime/host', () => ({ getPythonRuntimeService: () => service }));
vi.mock('./coworkUtil', async importOriginal => ({
  ...(await importOriginal<typeof import('./coworkUtil')>()),
  getEnhancedEnv: enhancedEnv,
}));

const roots: string[] = [];
const skillId = 'workspace-python-fixture';

async function fixture(requirements?: string) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'workspace-skill-python-')));
  roots.push(root);
  const skillDir = path.join(root, skillId);
  await mkdir(skillDir);
  const scriptPath = path.join(skillDir, 'script.py');
  await writeFile(scriptPath, 'print("fixture")\n');
  if (requirements !== undefined) {
    await writeFile(path.join(skillDir, 'requirements.txt'), requirements);
  }
  return {
    root,
    scriptPath,
    options: { skillId, skillsRoot: root, workspaceRoot: root, script: 'script.py' },
  };
}

beforeEach(() => {
  service.execute.mockReset().mockResolvedValue({
    stdout: 'workspace dependency imported\n',
    stderr: '',
    exitCode: 0,
    environmentId: 'same-workspace-environment',
    runtimeId: 'fixture',
    truncated: false,
  });
  service.prepare.mockReset();
  enhancedEnv.mockReset().mockResolvedValue({
    PATH: '/managed/node-and-tools',
    ZHIYUAN_ELECTRON_PATH: '/managed/electron',
    ZHIYUAN_NPM_BIN_DIR: '/managed/npm/bin',
    NODE_PATH: '/managed/node_modules',
  });
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

test('Python Skill execution uses the native workspace service with script argv and manifest identity', async () => {
  const { root, scriptPath, options } = await fixture('packaging==25.0\n');
  const controller = new AbortController();
  const result = await runManagedSkillScript({
    ...options,
    args: ['a b', '雪'],
    signal: controller.signal,
    confirmDependencyInstall: true,
  });

  expect(result).toMatchObject({
    ok: true,
    runtime: 'python',
    stdout: 'workspace dependency imported',
  });
  expect(service.prepare).not.toHaveBeenCalled();
  expect(service.execute).toHaveBeenCalledOnce();
  expect(service.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      workspace: root,
      scriptPath,
      args: ['a b', '雪'],
      skill: {
        skillId,
        requirementsPath: path.join(root, skillId, 'requirements.txt'),
        confirmDependencyInstall: true,
      },
      env: expect.objectContaining({ SKILLS_ROOT: root, ZHIYUAN_SKILLS_ROOT: root }),
    }),
    controller.signal,
  );
});

test('scripts without requirements share the workspace environment without inventing a Skill lock', async () => {
  const { options } = await fixture();
  expect((await runManagedSkillScript(options)).ok).toBe(true);
  expect(service.execute.mock.calls[0][0]).not.toHaveProperty('skill');
});

test('Python Skills retain managed Node and tool paths for nested subprocesses', async () => {
  const { options } = await fixture();
  expect((await runManagedSkillScript(options)).ok).toBe(true);
  expect(service.execute.mock.calls[0][0]).toMatchObject({
    env: {
      PATH: '/managed/node-and-tools',
      ZHIYUAN_ELECTRON_PATH: '/managed/electron',
      ZHIYUAN_NPM_BIN_DIR: '/managed/npm/bin',
      NODE_PATH: '/managed/node_modules',
    },
  });
});

test('runtime environment preparation failure retains process paths and reports the Skill identifier', async () => {
  const { options } = await fixture();
  const error = new Error('runtime fixture unavailable');
  enhancedEnv.mockRejectedValueOnce(error);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect((await runManagedSkillScript(options)).ok).toBe(true);
    expect(service.execute.mock.calls[0][0].env.PATH).toBe(process.env.PATH);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(skillId), error);
  } finally {
    warn.mockRestore();
  }
});

test('manifest rejection is returned to the model instead of falling back to another installer', async () => {
  const { options } = await fixture('packaging\n');
  service.execute.mockRejectedValue(new Error('Skill requirements manifest hash mismatch.'));
  expect(await runManagedSkillScript(options)).toMatchObject({
    ok: false,
    status: WorkspaceSkillStatus.Failed,
    errorCode: WorkspaceSkillError.DependenciesUnavailable,
    error: 'Skill requirements manifest hash mismatch.',
  });
  expect(service.execute).toHaveBeenCalledOnce();
  expect(service.prepare).not.toHaveBeenCalled();
});

test('missing large-download confirmation remains visible without retrying execution', async () => {
  const { options } = await fixture('scipy\n');
  service.execute.mockRejectedValue(new Error('Set confirmDependencyInstall=true after approval.'));
  expect(await runManagedSkillScript(options)).toMatchObject({
    ok: false,
    errorCode: WorkspaceSkillError.DependenciesUnavailable,
    error: expect.stringContaining('confirmDependencyInstall=true'),
  });
  expect(service.execute).toHaveBeenCalledOnce();
});

test('Python failures retain the script stderr and actual exit code', async () => {
  const { options } = await fixture();
  service.execute.mockResolvedValue({
    stdout: 'before failure\n',
    stderr: 'ValueError: fixture\n',
    exitCode: 7,
    environmentId: 'fixture',
    runtimeId: 'fixture',
    truncated: true,
  });
  expect(await runManagedSkillScript(options)).toMatchObject({
    ok: false,
    errorCode: WorkspaceSkillError.Failed,
    exitCode: 7,
    stdout: 'before failure',
    stderr: 'ValueError: fixture',
    stdoutTruncated: true,
  });
});

test('path escape and oversized arguments are rejected before the Python service starts', async () => {
  const { options } = await fixture();
  expect((await runManagedSkillScript({ ...options, script: '../outside.py' })).ok).toBe(false);
  expect((await runManagedSkillScript({ ...options, args: ['x'.repeat(16_385)] })).ok).toBe(false);
  expect(service.execute).not.toHaveBeenCalled();
  expect(service.prepare).not.toHaveBeenCalled();
});

test('an aborted Python request does not start the service', async () => {
  const { options } = await fixture();
  const controller = new AbortController();
  controller.abort();
  expect(await runManagedSkillScript({ ...options, signal: controller.signal })).toMatchObject({
    status: WorkspaceSkillStatus.Aborted,
    errorCode: WorkspaceSkillError.Aborted,
  });
  expect(service.execute).not.toHaveBeenCalled();
});

test.skipIf(process.platform === 'win32')(
  'shell Skills with Python dependencies bind child Python commands to the workspace interpreter',
  async () => {
    const { options, root } = await fixture('packaging==25.0\n');
    await writeFile(
      path.join(root, skillId, 'script.sh'),
      'printf "%s\\n" "$ZHIYUAN_SKILL_PYTHON_BIN" "$UV_PYTHON" "$PATH"\n',
    );
    service.prepare.mockResolvedValue({
      pythonPath: process.execPath,
      environmentId: 'same-workspace-environment',
      runtimeId: 'fixture',
    });
    const result = await runManagedSkillScript({ ...options, script: 'script.sh' });
    expect(result.ok).toBe(true);
    const [skillPython, uvPython, shellPath] = result.stdout.split('\n');
    expect(skillPython).toBe(process.execPath);
    expect(uvPython).toBe(process.execPath);
    expect(shellPath.split(path.delimiter)[0]).toBe(path.dirname(process.execPath));
    expect(service.prepare).toHaveBeenCalledOnce();
    expect(service.execute).not.toHaveBeenCalled();
  },
);

test('long-lived Python Skills launch the prepared workspace interpreter and preserve readiness and stop', async () => {
  const { options, scriptPath, root } = await fixture('packaging==25.0\n');
  // A Node fixture stands in for the resolved interpreter and makes its use observable.
  await writeFile(
    scriptPath,
    'process.on("SIGTERM",()=>{});process.stdout.write(JSON.stringify({ready:true,python:process.env.UV_PYTHON,path:process.env.PATH,pythonPath:process.env.PYTHONPATH}));setInterval(()=>{},1000);\n',
  );
  service.prepare.mockResolvedValue({
    pythonPath: process.execPath,
    environmentId: 'same-workspace-environment',
    runtimeId: 'fixture',
  });
  const handle = await startManagedSkillProcess(options);
  try {
    const output = await handle.waitForOutput(stdout => stdout.includes('ready'), 5_000);
    const environment = JSON.parse(output.stdout) as {
      ready: boolean;
      python: string;
      path: string;
    };
    expect(environment).toMatchObject({
      ready: true,
      python: process.execPath,
    });
    expect(environment.path.split(path.delimiter)[0]).toBe(path.dirname(process.execPath));
    expect(environment).not.toHaveProperty('pythonPath');
    expect(handle.command).toBe(process.execPath);
    expect(service.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: root,
        skill: expect.objectContaining({ skillId }),
      }),
      undefined,
    );
    expect(service.execute).not.toHaveBeenCalled();
  } finally {
    await Promise.all([handle.stop(), handle.stop()]);
  }
  expect(handle.isRunning()).toBe(false);
  expect(() => process.kill(handle.pid!, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
});
