import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { bundledRuntimeId } from './bundledRuntime';
import { PythonRuntimeService } from './service';

/** Resolve the bundled managed runtime for a standalone (non-Electron) run. */
const probe = async (path: string): Promise<string | undefined> =>
  (await access(path).then(
    () => true,
    () => false,
  ))
    ? path
    : undefined;

const enabled = process.env.PYTHON_RUNTIME_INTEGRATION === '1';
describe.skipIf(!enabled)('real standalone Python + uv workspace runtime', () => {
  let root: string, workspace: string, other: string, service: PythonRuntimeService;
  let globalPythonPath: string, globalUvPath: string, globalSharedPythonPath: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zhiyuan-python-integration-'));
    workspace = join(root, 'work a 雪');
    other = join(root, 'work b');
    await mkdir(workspace);
    await mkdir(other);
    await mkdir(join(root, 'storage'));
    const os =
      process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const pythonPath =
      (await probe(process.env.PYTHON_RUNTIME_BUNDLED_PYTHON!)) ??
      (await probe(
        resolve(
          `resources/python-${os}/${process.platform === 'win32' ? 'python.exe' : 'bin/python3'}`,
        ),
      ));
    const uvPath =
      (await probe(process.env.PYTHON_RUNTIME_BUNDLED_UV!)) ??
      (await probe(
        resolve(`resources/uv-${os}/${process.platform === 'win32' ? 'uv.exe' : 'uv'}`),
      ));
    const sharedPythonPath =
      (await probe(process.env.PYTHON_RUNTIME_BUNDLED_SHARED_PYTHON!)) ??
      (await probe(
        resolve(
          `resources/skill-python/layers/shared/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`,
        ),
      ));
    if (!pythonPath || !uvPath || !sharedPythonPath)
      throw new Error('Bundled managed runtime not found; run the setup:*-runtime scripts first.');
    service = new PythonRuntimeService({
      storageRoot: join(root, 'storage'),
      runnerPath: resolve(
        process.env.PYTHON_RUNTIME_RUNNER ?? 'dist-electron/python-runtime-runner.cjs',
      ),
      jobRunnerPath: process.env.PYTHON_RUNTIME_JOB_HELPER,
      preinstalledRuntime: { pythonPath, uvPath, sharedPythonPath, runtimeId: bundledRuntimeId() },
    });
    ({ pythonPath: globalPythonPath, uvPath: globalUvPath } = { pythonPath, uvPath });
    globalSharedPythonPath = sharedPythonPath;
  });
  afterAll(async () => {
    await service?.shutdown();
    if (root) await rm(root, { recursive: true, force: true });
  }, 120_000);
  test('execute uses pinned Python, workspace cwd, streams and exit code', async () => {
    const result = await service.execute({
      workspace,
      code: 'import sys,os;print(sys.version_info[:2]);print(os.getcwd());print("stderr",file=sys.stderr);sys.exit(9)',
      timeoutMs: 300000,
    });
    expect(result.stdout).toContain('(3, 14)');
    // Windows TEMP can use an 8.3 alias while Python reports the canonical long path.
    const reportedCwd = result.stdout.trim().split(/\r?\n/)[1];
    expect(await realpath(reportedCwd)).toBe(await realpath(workspace));
    expect(result.stderr).toContain('stderr');
    expect(result.exitCode).toBe(9);
  }, 310000);
  test('install is workspace-isolated; failed install preserves active environment; explicit rebuild retains pinned dependencies', async () => {
    const packages = ['pyfiglet>=1.0.2,<2'];
    if (process.platform === 'win32') packages.push('tablib==3.10.0');
    const installed = await service.install({
      workspace,
      packages,
      timeoutMs: 300000,
    });
    expect(installed.exitCode, installed.stderr).toBe(0);
    const imported = await service.execute({
      workspace,
      code: 'import importlib.metadata;print(importlib.metadata.version("pyfiglet"))',
    });
    const installedVersion = imported.stdout.trim();
    expect(installedVersion).toMatch(/^1\./);
    const isolated = await service.execute({
      workspace: other,
      code: 'import importlib.util;print(importlib.util.find_spec("pyfiglet"))',
    });
    expect(isolated.stdout.trim()).toBe('None');
    expect(isolated.environmentId).not.toBe(imported.environmentId);
    const failed = await service.install({
      workspace,
      packages: ['pyfiglet==0.0.0'],
      timeoutMs: 300000,
    });
    expect(failed.exitCode).not.toBe(0);
    expect((await service.execute({ workspace, code: 'print("still works")' })).environmentId).toBe(
      imported.environmentId,
    );
    const rebuilt = await service.install({ workspace, packages: [], rebuild: true });
    expect(rebuilt.environmentId).not.toBe(imported.environmentId);
    expect(
      (
        await service.execute({
          workspace,
          code: 'import importlib.metadata;print(importlib.metadata.version("pyfiglet"))',
        })
      ).stdout.trim(),
    ).toBe(installedVersion);
  }, 310000);
  test.skipIf(process.platform !== 'win32')(
    'Windows shortens an existing environment and can use tablib and openpyxl to read and write XLSX',
    async () => {
      const storage = join(root, 'storage');
      const prepared = await service.prepare({ workspace });
      const key = createHash('sha256')
        .update((await realpath(workspace)).toLowerCase())
        .digest('hex');
      const stateRoot = join(storage, 'workspaces-v2', key);
      const pointer = join(stateRoot, 'current.json');
      const current = JSON.parse(await readFile(pointer, 'utf8'));
      const legacyId = `${prepared.runtimeId}-${randomUUID()}`;
      const legacyRoot = join(stateRoot, legacyId);
      await rename(join(storage, 'venvs', prepared.environmentId), legacyRoot);
      await writeFile(pointer, JSON.stringify({ ...current, environmentId: legacyId }));

      const result = await service.execute({
        workspace,
        code: [
          'from io import BytesIO',
          'from importlib.metadata import version',
          'from openpyxl import load_workbook',
          'from tablib import Dataset',
          'workbook = load_workbook(BytesIO(Dataset([42]).export("xlsx")))',
          'print(version("tablib"), workbook.active["A1"].value)',
        ].join('\n'),
        timeoutMs: 100_000,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('3.10.0 42');
      expect(result.environmentId).not.toBe(legacyId);
      expect(await probe(join(legacyRoot, 'Scripts', 'python.exe'))).toBeDefined();
      expect((await service.prepare({ workspace })).pythonPath).toBe(
        join(storage, 'venvs', result.environmentId, 'Scripts', 'python.exe'),
      );
    },
    120_000,
  );
  test('preinstalled office libraries work offline and workspace package files are independent', async () => {
    const work = join(root, 'offline workspace');
    const another = join(root, 'offline other');
    await mkdir(work);
    await mkdir(another);
    // Baseline creation must succeed even if both network indexes are unreachable.
    const originalIndex = process.env.UV_INDEX;
    const originalDefault = process.env.UV_DEFAULT_INDEX;
    process.env.UV_INDEX = 'http://127.0.0.1:1/simple';
    process.env.UV_DEFAULT_INDEX = 'http://127.0.0.1:1/simple';
    try {
      const baseline = await service.execute({
        workspace: work,
        code: 'import pandas,numpy,openpyxl,matplotlib,reportlab,pypdf,pypdfium2,PIL;print("office ready")',
      });
      expect(baseline.exitCode, baseline.stderr).toBe(0);
      expect(baseline.stdout.trim()).toBe('office ready');
      const changed = await service.execute({
        workspace: work,
        code: 'import pathlib,sysconfig;pathlib.Path(sysconfig.get_path("purelib"),"workspace_only_package.py").write_text("value = 7")',
      });
      expect(changed.exitCode).toBe(0);
      const isolated = await service.execute({
        workspace: another,
        code: 'import importlib.util;print(importlib.util.find_spec("workspace_only_package"))',
      });
      expect(isolated.stdout.trim()).toBe('None');
      expect(isolated.environmentId).not.toBe(baseline.environmentId);
    } finally {
      if (originalIndex === undefined) delete process.env.UV_INDEX;
      else process.env.UV_INDEX = originalIndex;
      if (originalDefault === undefined) delete process.env.UV_DEFAULT_INDEX;
      else process.env.UV_DEFAULT_INDEX = originalDefault;
    }
  }, 120000);
  test('Skill scripts use the same workspace interpreter and declared dependency gate', async () => {
    const scriptPath = join(root, 'inspect workspace.py');
    await writeFile(join(root, 'skill_sibling.py'), 'value = 42\n');
    await writeFile(
      scriptPath,
      'import pyfiglet,sys,json,skill_sibling;assert skill_sibling.value == 42;print(json.dumps([sys.executable,sys.argv[1:]]))',
    );
    const script = await service.execute({ workspace, scriptPath, args: ['a b', '雪'] });
    const prepared = await service.prepare({ workspace });
    expect(script.exitCode, script.stderr).toBe(0);
    expect(JSON.parse(script.stdout)).toEqual([prepared.pythonPath, ['a b', '雪']]);
    expect(script.environmentId).toBe(prepared.environmentId);
    const requirementsPath = join(root, 'requirements.txt');
    await writeFile(requirementsPath, 'pandas>=99\n');
    await expect(
      service.execute({ workspace, scriptPath, skill: { skillId: 'xlsx', requirementsPath } }),
    ).rejects.toThrow('Skill dependency manifest');
    expect((await service.prepare({ workspace })).environmentId).toBe(prepared.environmentId);
  }, 120000);
  test('the pinned Python runs a compiled NumPy wheel without using system Python', async () => {
    const installed = await service.install({
      workspace,
      packages: ['numpy==2.3.4'],
      timeoutMs: 300000,
    });
    expect(installed.exitCode, installed.stderr).toBe(0);
    const result = await service.execute({
      workspace,
      code: 'import numpy,sys;print(numpy.__version__);print(int(numpy.arange(4).sum()));print(sys.prefix != sys.base_prefix)',
    });
    expect(result.stdout.trim().split(/\r?\n/)).toEqual(['2.3.4', '6', 'True']);
    expect(result.exitCode).toBe(0);
  }, 310000);
  test.skipIf(process.platform === 'win32')(
    'a hard-killed Runner cannot orphan its Python process group',
    async () => {
      const pidFile = join(workspace, 'hard-exit-pids.json');
      const runner = fork(
        resolve(process.env.PYTHON_RUNTIME_RUNNER ?? 'dist-electron/python-runtime-runner.cjs'),
        [],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      );
      let pids: number[] = [];
      const stopped = async (pid: number) => {
        if (process.platform === 'linux') {
          try {
            return (await readFile(`/proc/${pid}/stat`, 'utf8')).split(' ')[2] === 'Z';
          } catch {
            return true;
          }
        }
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      };
      try {
        runner.send({
          operation: 'execute',
          storageRoot: join(root, 'storage'),
          preinstalledRuntime: {
            pythonPath: globalPythonPath,
            uvPath: globalUvPath,
            sharedPythonPath: globalSharedPythonPath,
            runtimeId: bundledRuntimeId(),
          },
          input: {
            workspace,
            code: `import os,json,pathlib,subprocess,sys,time\np=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"])\npathlib.Path(${JSON.stringify(pidFile)}).write_text(json.dumps([os.getpid(),p.pid]))\ntime.sleep(60)`,
            timeoutMs: 60000,
          },
        });
        for (let i = 0; i < 100; i++) {
          try {
            pids = JSON.parse(await readFile(pidFile, 'utf8'));
            break;
          } catch {}
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        expect(pids).toHaveLength(2);
        const exited = new Promise(resolve => runner.once('exit', resolve));
        runner.kill('SIGKILL');
        await exited;
        for (let i = 0; i < 100 && !(await Promise.all(pids.map(stopped))).every(Boolean); i++)
          await new Promise(resolve => setTimeout(resolve, 50));
        expect(await Promise.all(pids.map(stopped))).toEqual([true, true]);
      } finally {
        runner.kill('SIGKILL');
        if (pids[0]) {
          try {
            process.kill(-pids[0], 'SIGKILL');
          } catch {}
        }
      }
    },
    15000,
  );
  test('timeout kills Python descendants and cancellation terminates active work', async () => {
    const pidFile = join(workspace, 'child.pid');
    await expect(
      service.execute({
        workspace,
        code: `import subprocess,sys,time,pathlib\np=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"])\npathlib.Path(${JSON.stringify(pidFile)}).write_text(str(p.pid))\ntime.sleep(60)`,
        timeoutMs: 700,
      }),
    ).rejects.toThrow('timed out');
    const pid = Number(await readFile(pidFile, 'utf8'));
    // Linux can briefly leave an adopted zombie; it cannot execute any work.
    if (process.platform === 'linux') {
      let stat = '';
      try {
        stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      } catch {}
      expect(!stat || stat.split(' ')[2] === 'Z').toBe(true);
    } else expect(() => process.kill(pid, 0)).toThrow();
    const controller = new AbortController();
    const running = service.execute(
      { workspace, code: 'import time;time.sleep(60)' },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 300);
    await expect(running).rejects.toThrow('cancelled');
  }, 10000);
});
