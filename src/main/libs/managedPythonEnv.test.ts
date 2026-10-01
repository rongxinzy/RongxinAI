import path from 'path';
import { expect, test, vi } from 'vitest';

vi.mock('./pythonRuntime', () => ({
  appendPythonRuntimeToEnv: (env: NodeJS.ProcessEnv) => {
    env.PATH = ['/managed/base', env.PATH].join(path.delimiter);
  },
}));
vi.mock('./skillPythonRuntime', () => ({
  findSharedSkillPythonExecutable: () => '/managed/shared/python',
}));
vi.mock('./uvRuntime', () => ({
  appendUvRuntimeToEnv: (env: NodeJS.ProcessEnv) => {
    env.PATH = ['/managed/uv', env.PATH].join(path.delimiter);
  },
  configureUvForManagedPython: (env: NodeJS.ProcessEnv) => {
    env.UV_PYTHON = '/managed/base/python';
  },
}));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => '/nonexistent' },
}));
vi.mock('./claudeSettings', () => ({}));
vi.mock('./systemProxy', () => ({}));
vi.mock('./coworkLogger', () => ({ coworkLog: vi.fn() }));

import { applyManagedPythonEnv } from './managedPythonEnv';
import { applyApplicationRuntimeEnv } from './coworkUtil';

test('keeps shared Python ahead of base Python on repeated environment preparation', () => {
  const env = { PATH: '/system/bin', UV_PYTHON: '' };
  applyManagedPythonEnv(env);
  const first = env.PATH;
  applyManagedPythonEnv(env);
  expect(env.PATH).toBe(first);
  expect(env.PATH.split(path.delimiter)[0]).toBe('/managed/shared');
  expect(env.UV_PYTHON).toBe('/managed/base/python');
});

test.skipIf(process.platform === 'win32')(
  'dev sessions receive Python dependencies and managed uv',
  () => {
    const env: NodeJS.ProcessEnv = { PATH: '/system/bin' };
    applyApplicationRuntimeEnv(env);
    expect(env.PATH?.split(path.delimiter)).toContain('/managed/shared');
    expect(env.PATH?.indexOf('/managed/shared')).toBeLessThan(
      env.PATH?.indexOf('/managed/base') ?? -1,
    );
    expect(env.UV_PYTHON).toBe('/managed/base/python');
  },
);
