import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { bundledRuntimeId } from './bundledRuntime';
import { runtimeNetworkEnvironment } from './process';
import { PythonRuntimeService } from './service';

const execFileAsync = promisify(execFile);
const enabled = process.env.PYTHON_RUNTIME_INTEGRATION === '1';
const fixtureSkillId = 'integration-delta-fixture';
const fixturePackage = 'colorama==0.4.6';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function executable(override: string | undefined, fallback: string): Promise<string> {
  for (const candidate of [override, resolve(fallback)]) {
    if (!candidate) continue;
    if (
      await access(candidate).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  }
  throw new Error(`Bundled integration runtime is missing (${fallback}).`);
}

describe.skipIf(!enabled)('real workspace Python Skill dependencies', () => {
  let root: string;
  let pythonPath: string;
  let uvPath: string;
  let sharedPythonPath: string;
  let runnerPath: string;
  const services: PythonRuntimeService[] = [];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zhiyuan-skill-integration-'));
    const platform =
      process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    pythonPath = await executable(
      process.env.PYTHON_RUNTIME_BUNDLED_PYTHON,
      `resources/python-${platform}/${process.platform === 'win32' ? 'python.exe' : 'bin/python3'}`,
    );
    uvPath = await executable(
      process.env.PYTHON_RUNTIME_BUNDLED_UV,
      `resources/uv-${platform}/${process.platform === 'win32' ? 'uv.exe' : 'uv'}`,
    );
    sharedPythonPath = await executable(
      process.env.PYTHON_RUNTIME_BUNDLED_SHARED_PYTHON,
      `resources/skill-python/layers/shared/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`,
    );
    runnerPath = resolve(
      process.env.PYTHON_RUNTIME_RUNNER ?? 'dist-electron/python-runtime-runner.cjs',
    );
  });

  afterAll(async () => {
    await Promise.all(services.map(service => service.shutdown()));
    if (root) await rm(root, { recursive: true, force: true });
  });

  function serviceFor(storage: string, baselinePython = sharedPythonPath) {
    const service = new PythonRuntimeService({
      storageRoot: join(root, storage),
      runnerPath,
      jobRunnerPath: process.env.PYTHON_RUNTIME_JOB_HELPER,
      preinstalledRuntime: {
        pythonPath,
        uvPath,
        sharedPythonPath: baselinePython,
        runtimeId: bundledRuntimeId(),
      },
      uvCacheDir: join(root, 'uv-cache'),
    });
    services.push(service);
    return service;
  }

  test('the current XLSX Skill uses its verified manifest and the workspace pandas environment', async () => {
    const workspace = join(root, 'xlsx workspace 雪');
    await mkdir(workspace);
    const service = serviceFor('xlsx-storage');
    const workbookPath = join(workspace, 'sample.xlsx');
    const created = await service.execute({
      workspace,
      code: [
        'import pandas as pd,sys',
        `pd.DataFrame({"Name":["Alice"],"Score":[98]}).to_excel(${JSON.stringify(workbookPath)},sheet_name="Scores",index=False)`,
        'print(sys.executable)',
      ].join('\n'),
      timeoutMs: 120_000,
    });
    expect(created.exitCode, created.stderr).toBe(0);
    const inspected = await service.execute({
      workspace,
      scriptPath: resolve('SKILLs/xlsx/scripts/xlsx_reader.py'),
      args: [workbookPath, '--json'],
      skill: {
        skillId: 'xlsx',
        requirementsPath: resolve('SKILLs/xlsx/requirements.txt'),
      },
      timeoutMs: 120_000,
    });
    expect(inspected.exitCode, inspected.stderr).toBe(0);
    expect(inspected.stdout).toContain('Scores');
    expect(inspected.stdout).toContain('Alice');
    expect(inspected.environmentId).toBe(created.environmentId);
    expect(inspected.pythonPath).toBe(created.stdout.trim());
    const pdf = await service.execute({
      workspace,
      scriptPath: resolve('SKILLs/pdf/scripts/render_body.py'),
      args: ['--help'],
      skill: { skillId: 'pdf', requirementsPath: resolve('SKILLs/pdf/requirements.txt') },
      timeoutMs: 120_000,
    });
    expect(pdf.exitCode, pdf.stderr).toBe(0);
    expect(pdf.environmentId).toBe(created.environmentId);
  }, 180_000);

  test('a verified v3 delta installs once with download approval and runs again without another approval', async () => {
    const fixtureRoot = join(root, 'minimal-skill-runtime');
    const sharedRoot = join(fixtureRoot, 'layers', 'shared');
    const fixtureSharedPython = join(
      sharedRoot,
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    const requirementsPath = join(root, 'delta-requirements.txt');
    const workspace = join(root, 'delta workspace');
    const manifestsRoot = join(fixtureRoot, 'skills', fixtureSkillId);
    const locksRoot = join(fixtureRoot, 'locks');
    const lockPath = join(locksRoot, `${fixtureSkillId}.delta.txt`);
    await Promise.all([
      mkdir(workspace),
      mkdir(manifestsRoot, { recursive: true }),
      mkdir(locksRoot, { recursive: true }),
    ]);
    const runUv = (args: string[]) =>
      execFileAsync(uvPath, args, {
        env: runtimeNetworkEnvironment(join(root, 'uv-cache')),
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
    await runUv([
      'venv',
      '--no-config',
      '--no-python-downloads',
      '--python',
      pythonPath,
      sharedRoot,
    ]);
    await runUv([
      'pip',
      'install',
      '--no-config',
      '--no-python-downloads',
      '--python',
      fixtureSharedPython,
      '--only-binary',
      ':all:',
      '--link-mode',
      'copy',
      'packaging==25.0',
    ]);
    await writeFile(
      join(sharedRoot, 'runtime.json'),
      JSON.stringify({ version: 3, kind: 'shared-layer', requirementsSha256: {} }),
    );
    const requirements = `${fixturePackage}\n`;
    await writeFile(requirementsPath, requirements);
    // uv obtains the real published artifact hashes. The fixture never invents a wheel hash.
    await runUv([
      'pip',
      'compile',
      '--no-config',
      '--no-python-downloads',
      '--python',
      fixtureSharedPython,
      '--only-binary',
      ':all:',
      '--generate-hashes',
      '--output-file',
      lockPath,
      requirementsPath,
    ]);
    const lock = await readFile(lockPath, 'utf8');
    expect(lock).toContain('--hash=sha256:');
    await writeFile(
      join(manifestsRoot, 'runtime.json'),
      JSON.stringify({
        version: 3,
        skillId: fixtureSkillId,
        requirementsSha256: hash(requirements),
        coverage: 'overlay',
        delta: {
          lockFile: `${fixtureSkillId}.delta.txt`,
          sha256: hash(lock),
          // Synthetic approval metadata exercises the download gate with a small real wheel.
          // This test does not install or claim to validate scipy itself.
          packages: ['colorama', 'scipy'],
          packageCount: 1,
        },
      }),
    );
    const service = serviceFor('delta-storage', fixtureSharedPython);
    const skill = { skillId: fixtureSkillId, requirementsPath };
    const scriptPath = join(workspace, 'use_delta.py');
    await writeFile(scriptPath, 'import colorama;print(colorama.__version__)\n');
    await expect(service.execute({ workspace, scriptPath, skill })).rejects.toThrow(
      'Skill dependencies require confirmation',
    );
    const installed = await service.execute({
      workspace,
      scriptPath,
      skill: { ...skill, confirmDependencyInstall: true },
      timeoutMs: 120_000,
    });
    expect(installed.exitCode, installed.stderr).toBe(0);
    expect(installed.stdout.trim()).toBe('0.4.6');
    const reused = await service.execute({ workspace, scriptPath, skill });
    expect(reused.exitCode, reused.stderr).toBe(0);
    expect(reused.stdout.trim()).toBe('0.4.6');
    expect(reused.environmentId).toBe(installed.environmentId);
    const nativeCode = await service.execute({
      workspace,
      code: 'import colorama;print(colorama.__version__)',
    });
    expect(nativeCode.exitCode, nativeCode.stderr).toBe(0);
    expect(nativeCode.stdout.trim()).toBe('0.4.6');
    expect(nativeCode.environmentId).toBe(installed.environmentId);
    const unrelatedInstall = await service.install({ workspace, packages: ['packaging>=25,<26'] });
    expect(unrelatedInstall.exitCode, unrelatedInstall.stderr).toBe(0);
    const afterInstall = await service.execute({ workspace, scriptPath, skill });
    expect(afterInstall.exitCode, afterInstall.stderr).toBe(0);
    expect(afterInstall.environmentId).toBe(unrelatedInstall.environmentId);
    // Even a previously installed Skill must authenticate the current lock before reusing it.
    await writeFile(lockPath, `${lock}# modified after installation\n`);
    await expect(service.execute({ workspace, scriptPath, skill })).rejects.toThrow(
      'delta lock hash does not match',
    );
    expect((await service.prepare({ workspace })).environmentId).toBe(
      unrelatedInstall.environmentId,
    );
  }, 240_000);
});
