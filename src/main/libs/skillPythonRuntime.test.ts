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
  findSkillPythonExecutable,
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

test.each(['openpyxl==3.1.5\n', ''])(
  'probes the shared executable only for a matching requirements file',
  async requirements => {
    const skillId = 'fixture-skill';
    const runtimeRoot = path.join(userDataRoot, 'runtimes', 'skill-python');
    const executable = createSharedExecutable(runtimeRoot);
    const manifestRoot = path.join(runtimeRoot, 'skills', skillId);
    fs.mkdirSync(manifestRoot, { recursive: true });
    const manifestPath = path.join(manifestRoot, 'runtime.json');
    const requirementsPath = path.join(userDataRoot, 'requirements.txt');
    fs.writeFileSync(requirementsPath, requirements);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        skillId,
        requirementsSha256: crypto.createHash('sha256').update(requirements).digest('hex'),
      }),
    );

    await expect(findSkillPythonExecutable(skillId, requirementsPath)).resolves.toBe(executable);
    fs.appendFileSync(requirementsPath, '# changed after packaging\n');
    await expect(findSkillPythonExecutable(skillId, requirementsPath)).resolves.toBeNull();

    const oversized = 'x'.repeat(64 * 1024 + 1);
    fs.writeFileSync(requirementsPath, oversized);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        skillId,
        requirementsSha256: crypto.createHash('sha256').update(oversized).digest('hex'),
      }),
    );
    await expect(findSkillPythonExecutable(skillId, requirementsPath)).resolves.toBeNull();
  },
);
