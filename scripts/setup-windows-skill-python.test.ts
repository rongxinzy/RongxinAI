import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { finalizeWindowsSkillPython } from './setup-windows-skill-python.cjs';

test('standalone Windows layer keeps wheels once and removes the build-host redirector', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-python-layout-'));
  const base = path.join(root, 'base');
  const shared = path.join(root, 'shared');
  try {
    for (const directory of [base, shared]) {
      fs.mkdirSync(path.join(directory, 'Lib', 'site-packages'), { recursive: true });
    }
    fs.mkdirSync(path.join(shared, 'Scripts'));
    fs.writeFileSync(path.join(base, 'python.exe'), 'real interpreter');
    fs.writeFileSync(path.join(base, 'python314.dll'), 'runtime');
    fs.writeFileSync(path.join(base, 'Lib', 'os.py'), 'stdlib');
    fs.writeFileSync(path.join(base, 'Lib', 'site-packages', 'host_only.py'), 'excluded');
    fs.writeFileSync(path.join(shared, 'Scripts', 'python.exe'), 'redirector');
    fs.writeFileSync(path.join(shared, 'Lib', 'site-packages', 'fixture.py'), 'wheel');
    fs.writeFileSync(path.join(shared, 'pyvenv.cfg'), `home = ${base}\n`);
    finalizeWindowsSkillPython(shared, path.join(base, 'python.exe'), 'win32');
    finalizeWindowsSkillPython(shared, path.join(base, 'python.exe'), 'win32');
    expect(fs.existsSync(path.join(shared, 'pyvenv.cfg'))).toBe(false);
    expect(fs.existsSync(path.join(shared, 'Lib'))).toBe(false);
    expect(fs.readFileSync(path.join(shared, 'Scripts', 'python3.exe'), 'utf8')).toBe(
      'real interpreter',
    );
    expect(
      fs.readFileSync(path.join(shared, 'Scripts', 'Lib', 'site-packages', 'fixture.py'), 'utf8'),
    ).toBe('wheel');
    expect(
      fs.existsSync(path.join(shared, 'Scripts', 'Lib', 'site-packages', 'host_only.py')),
    ).toBe(false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'Windows Python survives relocation without the original venv or system PATH',
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'python relocation 中文 '));
    const build = path.join(root, 'build');
    const moved = path.join(root, 'installed 中文');
    try {
      const base = spawnSync('python', ['-I', '-c', 'import sys; print(sys._base_executable)'], {
        encoding: 'utf8',
      });
      expect(base.status, base.stderr).toBe(0);
      const basePython = base.stdout.trim();
      const create = spawnSync(basePython, ['-m', 'venv', '--without-pip', build], {
        encoding: 'utf8',
      });
      expect(create.status, create.stderr).toBe(0);
      fs.writeFileSync(
        path.join(build, 'Lib', 'site-packages', 'ci_dependency.py'),
        'value = 42\n',
      );
      finalizeWindowsSkillPython(build, basePython, 'win32');
      fs.renameSync(build, moved);
      const fixture = path.join(root, 'probe.py');
      fs.writeFileSync(path.join(root, 'local_module.py'), 'value = 7\n');
      fs.writeFileSync(
        fixture,
        'import sys, json, ssl, sqlite3, ci_dependency, local_module\nprint(json.dumps([sys.prefix, ci_dependency.value, local_module.value]))\n',
      );
      for (const name of ['python.exe', 'python3.exe']) {
        const result = spawnSync(path.join(moved, 'Scripts', name), [fixture], {
          encoding: 'utf8',
          env: { ...process.env, PATH: process.env.SystemRoot, PYTHONHOME: '', PYTHONPATH: '' },
        });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual([path.join(moved, 'Scripts'), 42, 7]);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  60_000,
);
