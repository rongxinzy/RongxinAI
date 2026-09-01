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

import { findSharedSkillPythonExecutable } from './skillPythonRuntime';

const sharedExecutableRelPath =
  process.platform === 'win32'
    ? path.join('Scripts', 'python.exe')
    : path.join('bin', 'python3');

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
  expect(findSharedSkillPythonExecutable()).toBeNull();
});

test('resolves the shared layer interpreter under the userData runtime root', () => {
  const expected = createSharedExecutable(
    path.join(userDataRoot, 'runtimes', 'skill-python'),
  );
  expect(findSharedSkillPythonExecutable()).toBe(expected);
});
