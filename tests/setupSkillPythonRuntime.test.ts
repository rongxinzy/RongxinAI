import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildProbeCode,
  describeProbeFailure,
  ensureWindowsPython3Alias,
  listRequirementFiles,
  normalizePlatform,
  parseImportNames,
  probePython,
  rebaseEnvironmentSymlinks,
  sharedLockPath,
  validateSkillDependencyDeclarations,
} from '../scripts/setup-skill-python-runtime.js';

function findPythonExecutable() {
  for (const candidate of ['python3', 'python']) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }
  return null;
}

describe('setup-skill-python-runtime', () => {
  it('normalizes supported packaging platforms', () => {
    expect(normalizePlatform('windows')).toBe('win32');
    expect(normalizePlatform('macOS')).toBe('darwin');
    expect(normalizePlatform('linux')).toBe('linux');
  });

  it('maps package names to import names and ignores requirement options', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-python-'));
    try {
      const requirements = path.join(root, 'requirements.txt');
      fs.writeFileSync(
        requirements,
        '# comment\nPillow>=10\nscikit-learn>=1\npsycopg2-binary>=2.9\n--extra-index-url https://example.invalid\n',
      );
      expect(parseImportNames(requirements)).toEqual(['PIL', 'sklearn', 'psycopg2']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds requirements files in nested Skill roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
    try {
      fs.mkdirSync(path.join(root, 'xlsx'), { recursive: true });
      fs.mkdirSync(path.join(root, 'docx'), { recursive: true });
      fs.writeFileSync(path.join(root, 'xlsx', 'requirements.txt'), 'openpyxl>=3\n');
      expect(listRequirementFiles(root).map(entry => entry.skillId)).toEqual(['xlsx']);

      const nested = path.join(root, 'expert', 'presets', 'cad', 'skills', 'text-to-cad');
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, 'requirements.txt'), 'cadgen==0.4.28\n');
      expect(listRequirementFiles(root).map(entry => entry.skillId)).toEqual([
        'text-to-cad',
        'xlsx',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('stores one aggregate lock for the shared environment', () => {
    expect(sharedLockPath('/runtime/skill-python')).toBe(
      path.join('/runtime/skill-python', 'locks', 'shared.txt'),
    );
  });

  it('requires third-party Python imports to be declared by their Skill', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
    try {
      const skillRoot = path.join(root, 'analysis');
      fs.mkdirSync(path.join(skillRoot, 'scripts'), { recursive: true });
      fs.writeFileSync(
        path.join(skillRoot, 'scripts', 'analyze.py'),
        'import json\nimport pandas as pd\nfrom helpers import report\n',
      );
      fs.writeFileSync(path.join(skillRoot, 'scripts', 'helpers.py'), 'def report(): pass\n');

      expect(validateSkillDependencyDeclarations(root)).toEqual({
        ok: false,
        missing: ['analysis: pandas is imported but not declared in requirements.txt'],
      });

      fs.writeFileSync(path.join(skillRoot, 'requirements.txt'), 'pandas>=2.2,<3\n');
      expect(validateSkillDependencyDeclarations(root)).toEqual({ ok: true, missing: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rebases POSIX environment links to the sibling packaged Python runtime', () => {
    const resourcesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-python-links-'));
    try {
      const basePython = path.join(resourcesRoot, 'python-mac', 'bin', 'python3');
      const environmentRoot = path.join(resourcesRoot, 'skill-python', 'layers', 'shared');
      const environmentPython = path.join(environmentRoot, 'bin', 'python3');
      fs.mkdirSync(path.dirname(basePython), { recursive: true });
      fs.mkdirSync(path.dirname(environmentPython), { recursive: true });
      fs.writeFileSync(basePython, '');
      fs.symlinkSync(basePython, environmentPython);

      rebaseEnvironmentSymlinks(environmentRoot, basePython);

      const rebasedTarget = fs.readlinkSync(environmentPython);
      expect(path.isAbsolute(rebasedTarget)).toBe(false);
      expect(path.resolve(path.dirname(environmentPython), rebasedTarget)).toBe(basePython);
    } finally {
      fs.rmSync(resourcesRoot, { recursive: true, force: true });
    }
  });

  it('creates the Windows python3.exe alias beside the shared python.exe', () => {
    const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-python-alias-'));
    try {
      const scriptsDir = path.join(sharedRoot, 'Scripts');
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.writeFileSync(path.join(scriptsDir, 'python.exe'), 'trampoline');

      ensureWindowsPython3Alias(sharedRoot, 'win32');

      expect(fs.readFileSync(path.join(scriptsDir, 'python3.exe'), 'utf8')).toBe('trampoline');

      // Idempotent, POSIX no-op, and missing python.exe is tolerated.
      fs.writeFileSync(path.join(scriptsDir, 'python3.exe'), 'existing');
      ensureWindowsPython3Alias(sharedRoot, 'win32');
      expect(fs.readFileSync(path.join(scriptsDir, 'python3.exe'), 'utf8')).toBe('existing');
      ensureWindowsPython3Alias(sharedRoot, 'darwin');
      ensureWindowsPython3Alias(path.join(sharedRoot, 'empty'), 'win32');
    } finally {
      fs.rmSync(sharedRoot, { recursive: true, force: true });
    }
  });

  it('announces each import before running it in the probe code', () => {
    const code = buildProbeCode(['numpy', 'trimesh']);
    expect(code).toContain('print("importing numpy", file=sys.stderr, flush=True)');
    expect(code).toContain('importlib.import_module("numpy")');
    expect(code.indexOf('importing numpy')).toBeLessThan(code.indexOf('import_module("numpy")'));
    expect(code).toContain('print("importing trimesh", file=sys.stderr, flush=True)');
    expect(code).toContain('print("skill-python-health-ok")');
  });

  it('describes probe timeouts, signals, exit codes, and output tails', () => {
    expect(
      describeProbeFailure(
        { error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) },
        60_000,
      ),
    ).toBe('probe timed out after 60s');
    expect(describeProbeFailure({ signal: 'SIGTERM', status: null }, 60_000)).toBe(
      'probe killed by signal SIGTERM',
    );
    expect(describeProbeFailure({ status: 1, stderr: 'boom' }, 60_000)).toBe(
      'probe exited with code 1; output tail:\nboom',
    );
    const longOutput = Array.from({ length: 30 }, (_, index) => `line-${index}`).join('\n');
    const described = describeProbeFailure({ status: 1, stderr: longOutput }, 60_000);
    expect(described).toContain('line-29');
    expect(described).not.toContain('line-9');
  });

  it('probes imports with the real interpreter when one is available', () => {
    const python = findPythonExecutable();
    if (!python) return;

    expect(probePython(python, ['json'], { timeoutMs: 30_000 })).toEqual({ ok: true, detail: '' });

    const failing = probePython(python, ['json', 'definitely_missing_module_zz9'], {
      timeoutMs: 30_000,
    });
    expect(failing.ok).toBe(false);
    expect(failing.detail).toContain('probe exited with code 1');
    expect(failing.detail).toContain('importing definitely_missing_module_zz9');
    expect(failing.detail).toContain('ModuleNotFoundError');
  });
});
