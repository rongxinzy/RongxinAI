import { fork } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PythonRuntimeService } from './service';

const enabled = process.env.PYTHON_RUNTIME_INTEGRATION === '1';
describe.skipIf(!enabled)('real standalone Python + uv workspace runtime', () => {
  let root: string, workspace: string, other: string, service: PythonRuntimeService;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zhiyuan-python-integration-'));
    workspace = join(root, 'work a 雪');
    other = join(root, 'work b');
    await mkdir(workspace);
    await mkdir(other);
    await mkdir(join(root, 'storage'));
    if (process.env.PYTHON_RUNTIME_TEST_CACHE)
      await symlink(
        resolve(process.env.PYTHON_RUNTIME_TEST_CACHE, 'runtimes'),
        join(root, 'storage/runtimes'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    service = new PythonRuntimeService({
      storageRoot: join(root, 'storage'),
      runnerPath: resolve(
        process.env.PYTHON_RUNTIME_RUNNER ?? 'dist-electron/python-runtime-runner.cjs',
      ),
      jobRunnerPath: process.env.PYTHON_RUNTIME_JOB_HELPER,
    });
  });
  afterAll(async () => {
    await service?.shutdown();
    if (root) await rm(root, { recursive: true, force: true });
  });
  test('execute uses pinned Python, workspace cwd, streams and exit code', async () => {
    const result = await service.execute({
      workspace,
      code: 'import sys,os;print(sys.version_info[:2]);print(os.getcwd());print("stderr",file=sys.stderr);sys.exit(9)',
      timeoutMs: 300000,
    });
    expect(result.stdout).toContain('(3, 12)');
    // Windows TEMP can use an 8.3 alias while Python reports the canonical long path.
    const reportedCwd = result.stdout.trim().split(/\r?\n/)[1];
    expect(await realpath(reportedCwd)).toBe(await realpath(workspace));
    expect(result.stderr).toContain('stderr');
    expect(result.exitCode).toBe(9);
  }, 310000);
  test('install is workspace-isolated; failed install preserves active environment; explicit rebuild retains pinned dependencies', async () => {
    const installed = await service.install({
      workspace,
      packages: ['packaging==25.0'],
      timeoutMs: 300000,
    });
    expect(installed.exitCode).toBe(0);
    const imported = await service.execute({
      workspace,
      code: 'import packaging;print(packaging.__version__)',
    });
    expect(imported.stdout.trim()).toBe('25.0');
    const isolated = await service.execute({
      workspace: other,
      code: 'import importlib.util;print(importlib.util.find_spec("packaging"))',
    });
    expect(isolated.stdout.trim()).toBe('None');
    expect(isolated.environmentId).not.toBe(imported.environmentId);
    const failed = await service.install({
      workspace,
      packages: ['packaging==0.0.0'],
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
        await service.execute({ workspace, code: 'import packaging;print(packaging.__version__)' })
      ).stdout.trim(),
    ).toBe('25.0');
  }, 310000);
  test('the pinned Python runs a compiled NumPy wheel without using system Python', async () => {
    const installed = await service.install({
      workspace,
      packages: ['numpy==2.2.6'],
      timeoutMs: 300000,
    });
    expect(installed.exitCode, installed.stderr).toBe(0);
    const result = await service.execute({
      workspace,
      code: 'import numpy,sys;print(numpy.__version__);print(int(numpy.arange(4).sum()));print(sys.prefix != sys.base_prefix)',
    });
    expect(result.stdout.trim().split(/\r?\n/)).toEqual(['2.2.6', '6', 'True']);
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
