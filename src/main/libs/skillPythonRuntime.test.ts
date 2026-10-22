/**
 * Unit tests for the shared Skill Python layer resolution.
 *
 * Verifies that findSharedSkillPythonExecutable locates the shared dependency
 * layer's interpreter without per-Skill manifest gating, so the agent's shell
 * PATH can expose the managed environment (pandas/numpy/...) for ad-hoc
 * scripts.
 *
 * Mocks the `electron` module so the module can be imported outside Electron.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

let userDataRoot = '';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => userDataRoot,
    getPath: (name: string) => (name === 'userData' ? userDataRoot : '/nonexistent'),
  },
}));

import {
  ensureSharedSkillWindowsPython3Alias,
  findSharedSkillPythonExecutable,
  resolveSkillPython,
  skillPythonDependencyStatus,
  skillPythonOverlayRoot,
} from './skillPythonRuntime';

const sharedExecutableRelPath =
  process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python3');

const createSharedExecutable = (runtimeRoot: string): string => {
  const executable = path.join(runtimeRoot, 'layers', 'shared', sharedExecutableRelPath);
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, '');
  return executable;
};

beforeEach(() => {
  userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-python-runtime-'));
});

afterEach(() => {
  fs.rmSync(userDataRoot, { recursive: true, force: true });
});

test('returns null when no shared layer exists', () => {
  // A developer machine that already ran a packaging build has the layer in
  // resources/skill-python, and the resolver deliberately searches bundled
  // candidates too — only assert the absence case when nothing is bundled.
  const bundled = path.join(
    process.cwd(),
    'resources',
    'skill-python',
    'layers',
    'shared',
    sharedExecutableRelPath,
  );
  if (fs.existsSync(bundled)) return;
  expect(findSharedSkillPythonExecutable()).toBeNull();
});

test('resolves the shared layer interpreter under the userData runtime root', () => {
  const expected = createSharedExecutable(path.join(userDataRoot, 'runtimes', 'skill-python'));
  expect(findSharedSkillPythonExecutable()).toBe(expected);
});

test('creates the Windows python3.exe alias beside the shared python.exe', () => {
  const scriptsDir = path.join(
    userDataRoot,
    'runtimes',
    'skill-python',
    'layers',
    'shared',
    'Scripts',
  );
  fs.mkdirSync(scriptsDir, { recursive: true });
  const pythonExe = path.join(scriptsDir, 'python.exe');
  fs.writeFileSync(pythonExe, 'trampoline');

  ensureSharedSkillWindowsPython3Alias('win32');

  const python3Exe = path.join(scriptsDir, 'python3.exe');
  expect(fs.existsSync(python3Exe)).toBe(true);
  expect(fs.readFileSync(python3Exe, 'utf8')).toBe('trampoline');

  // Idempotent: a second pass must not rewrite the existing alias.
  fs.writeFileSync(python3Exe, 'existing');
  ensureSharedSkillWindowsPython3Alias('win32');
  expect(fs.readFileSync(python3Exe, 'utf8')).toBe('existing');
});

test('leaves the shared layer untouched on non-Windows platforms', () => {
  const scriptsDir = path.join(
    userDataRoot,
    'runtimes',
    'skill-python',
    'layers',
    'shared',
    'Scripts',
  );
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, 'python.exe'), 'trampoline');

  ensureSharedSkillWindowsPython3Alias('linux');

  expect(fs.existsSync(path.join(scriptsDir, 'python3.exe'))).toBe(false);
});

const SKILL_ID = 'fixture-overlay-skill';

function writeFixtureSkill(options: {
  requirements: string;
  manifest: Record<string, unknown>;
  runtimeRoot?: string;
  lockFile?: { name: string; content: string };
}): { skillDir: string; requirementsPath: string; runtimeRoot: string } {
  const runtimeRoot = options.runtimeRoot ?? path.join(userDataRoot, 'runtimes', 'skill-python');
  const skillDir = path.join(userDataRoot, 'SKILLs', SKILL_ID);
  fs.mkdirSync(skillDir, { recursive: true });
  const requirementsPath = path.join(skillDir, 'requirements.txt');
  fs.writeFileSync(requirementsPath, options.requirements);
  const manifestRoot = path.join(runtimeRoot, 'skills', SKILL_ID);
  fs.mkdirSync(manifestRoot, { recursive: true });
  fs.writeFileSync(
    path.join(manifestRoot, 'runtime.json'),
    JSON.stringify({ skillId: SKILL_ID, version: 3, ...options.manifest }, null, 2),
  );
  if (options.lockFile) {
    const locksDir = path.join(runtimeRoot, 'locks');
    fs.mkdirSync(locksDir, { recursive: true });
    fs.writeFileSync(path.join(locksDir, options.lockFile.name), options.lockFile.content);
  }
  return { skillDir, requirementsPath, runtimeRoot };
}

const requirementsHash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

test('resolves a core-covered Skill against the packaged layer', () => {
  const requirements = 'openpyxl==3.1.5\n';
  createSharedExecutable(path.join(userDataRoot, 'runtimes', 'skill-python'));
  const { requirementsPath } = writeFixtureSkill({
    requirements,
    manifest: { requirementsSha256: requirementsHash(requirements), coverage: 'core', delta: null },
  });

  const resolution = resolveSkillPython(SKILL_ID, requirementsPath);

  expect(resolution.kind).toBe('ready');
  if (resolution.kind !== 'ready') return;
  expect(resolution.coverage).toBe('core');
  expect(resolution.sitePackages).toBeNull();
  expect(skillPythonDependencyStatus(SKILL_ID, requirementsPath)).toEqual({
    status: 'core',
    skillId: SKILL_ID,
  });
});

test('reports a missing overlay together with its pinned delta lock', () => {
  const requirements = 'scipy\nstatsmodels\n';
  createSharedExecutable(path.join(userDataRoot, 'runtimes', 'skill-python'));
  const { requirementsPath } = writeFixtureSkill({
    requirements,
    manifest: {
      requirementsSha256: requirementsHash(requirements),
      coverage: 'overlay',
      delta: {
        lockFile: `${SKILL_ID}.delta.txt`,
        sha256: 'lock-hash',
        packageCount: 2,
        packages: ['scipy', 'statsmodels'],
      },
    },
    lockFile: { name: `${SKILL_ID}.delta.txt`, content: 'scipy==1.18.1\nstatsmodels==0.15.0\n' },
  });

  const resolution = resolveSkillPython(SKILL_ID, requirementsPath);

  expect(resolution.kind).toBe('dependencies-missing');
  if (resolution.kind !== 'dependencies-missing') return;
  expect(resolution.lockPath).toContain(`${SKILL_ID}.delta.txt`);
  const status = skillPythonDependencyStatus(SKILL_ID, requirementsPath);
  expect(status.status).toBe('missing');
  if (status.status !== 'missing') return;
  expect(status.packageCount).toBe(2);
  expect(status.lockSha256).toBe('lock-hash');
});

test('uses an installed overlay whose lock hash still matches', () => {
  const requirements = 'scipy\n';
  createSharedExecutable(path.join(userDataRoot, 'runtimes', 'skill-python'));
  const { requirementsPath } = writeFixtureSkill({
    requirements,
    manifest: {
      requirementsSha256: requirementsHash(requirements),
      coverage: 'overlay',
      delta: {
        lockFile: `${SKILL_ID}.delta.txt`,
        sha256: 'lock-hash',
        packageCount: 1,
        packages: ['scipy'],
      },
    },
  });
  const overlay = skillPythonOverlayRoot(SKILL_ID);
  fs.mkdirSync(overlay, { recursive: true });
  fs.writeFileSync(
    path.join(overlay, 'runtime.json'),
    JSON.stringify({ version: 3, skillId: SKILL_ID, lockSha256: 'lock-hash', packageCount: 1 }),
  );

  const resolution = resolveSkillPython(SKILL_ID, requirementsPath);

  expect(resolution.kind).toBe('ready');
  if (resolution.kind !== 'ready') return;
  expect(resolution.sitePackages).toBe(overlay);
  expect(skillPythonDependencyStatus(SKILL_ID, requirementsPath)).toMatchObject({
    status: 'installed',
    packageCount: 1,
  });
});

test('refuses a layer whose manifest predates the Skill copy', () => {
  const requirements = 'scipy\n';
  createSharedExecutable(path.join(userDataRoot, 'runtimes', 'skill-python'));
  const { requirementsPath } = writeFixtureSkill({
    requirements,
    manifest: { requirementsSha256: 'stale-hash', coverage: 'core', delta: null },
  });

  expect(resolveSkillPython(SKILL_ID, requirementsPath)).toEqual({
    kind: 'runtime-missing',
    skillId: SKILL_ID,
    reason: 'stale-skill',
  });
});
