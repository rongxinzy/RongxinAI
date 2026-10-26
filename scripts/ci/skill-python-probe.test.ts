import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { createSkillPythonProbe } = require('./skill-python-probe.cjs') as {
  createSkillPythonProbe: (root: string) => string;
};
const roots: string[] = [];

function fixture(core: string, overlay = 'zhiyuan_missing_overlay') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'skill-python-probe-'));
  roots.push(root);
  for (const [skill, requirements] of [
    ['xlsx', core],
    ['regression-insight', overlay],
  ]) {
    const directory = path.join(root, 'SKILLs', skill);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'requirements.txt'), requirements);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('the generated probe imports core dependencies without requiring on-demand overlays', () => {
  const root = fixture('json\n');
  const probe = path.join(root, 'probe.py');
  const generate = spawnSync(
    process.execPath,
    [path.join(__dirname, 'skill-python-probe.cjs'), root, probe],
    {
      encoding: 'utf8',
    },
  );
  expect(generate.status, generate.stderr).toBe(0);
  expect(readFileSync(probe, 'utf8')).not.toContain('zhiyuan_missing_overlay');
  const run = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', probe], {
    encoding: 'utf8',
  });
  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout).toContain('skill-python-health-ok');
});

test('missing dependencies declared by a core Skill still fail the probe', () => {
  const root = fixture('zhiyuan_missing_core\n');
  const probe = path.join(root, 'probe.py');
  writeFileSync(probe, createSkillPythonProbe(root));
  const run = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', probe], {
    encoding: 'utf8',
  });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain("No module named 'zhiyuan_missing_core'");
});

test('probe selection follows changed core requirements and rejects an empty dependency set', () => {
  const root = fixture('json\n');
  const original = createSkillPythonProbe(root);
  writeFileSync(path.join(root, 'SKILLs/xlsx/requirements.txt'), 'pathlib\n');
  expect(createSkillPythonProbe(root)).not.toBe(original);
  expect(createSkillPythonProbe(root)).toContain('importing pathlib');
  writeFileSync(path.join(root, 'SKILLs/xlsx/requirements.txt'), '# no core dependencies\n');
  expect(() => createSkillPythonProbe(root)).toThrow('No offline Skill Python dependencies');
});

test('the real offline policy probes office dependencies and excludes on-demand scientific packages', () => {
  const probe = createSkillPythonProbe(path.resolve(__dirname, '../..'));
  expect(probe).toContain('importing pandas');
  expect(probe).toContain('importing openpyxl');
  expect(probe).toContain('importing PIL');
  expect(probe).not.toContain('importing scipy');
  expect(probe).not.toContain('importing statsmodels');
});
