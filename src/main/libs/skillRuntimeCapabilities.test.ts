import type { SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  electron: '/managed/electron',
}));

vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./coworkUtil', () => ({
  getElectronNodeRuntimePath: () => mocks.electron,
  getSkillsRoot: () => '/managed/skills',
}));
vi.mock('./pythonRuntime', () => ({
  getManagedPythonExecutable: () => '/managed/python',
}));
vi.mock('./skillPythonRuntime', () => ({
  findSkillPythonExecutable: async (skillId: string) => `/managed/${skillId}/python`,
}));
vi.mock('./uvRuntime', () => ({
  findBundledUvExecutable: () => '/managed/uv',
}));

import { probeSkillRuntimeCapabilities } from './skillRuntimeCapabilities';

beforeEach(() => {
  mocks.spawn.mockReset();
  mocks.spawn.mockImplementation((executable: string, _args: string[], options: SpawnOptions) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      // Electron's --version succeeds in both modes, but only Node mode reports
      // the version of the runtime that executes JavaScript Skill scripts.
      const version =
        executable === mocks.electron
          ? options.env?.ELECTRON_RUN_AS_NODE === '1'
            ? 'v24.22.0'
            : 'v44.9.3'
          : executable.endsWith('/python')
            ? 'Python 3.14.6'
            : 'available';
      child.stdout.end(`${version}\n`);
      child.emit('close', 0);
    });
    return child;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test('reports the embedded Node version rather than the Electron application version', async () => {
  const report = await probeSkillRuntimeCapabilities();

  expect(report.platform).toBe(process.platform);
  expect(report.arch).toBe(process.arch);
  expect(report.node).toEqual({
    available: true,
    executable: mocks.electron,
    version: 'v24.22.0',
  });
  expect(report.python.version).toBe('Python 3.14.6');
  expect(report.skillPython.xlsx.version).toBe('Python 3.14.6');
});

test('keeps the Node mode override local to its probe and preserves inherited environment', async () => {
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '0');
  vi.stubEnv('RUNTIME_PROBE_SENTINEL', 'preserved');

  await probeSkillRuntimeCapabilities();

  const nodeCall = mocks.spawn.mock.calls.find(([executable]) => executable === mocks.electron);
  expect(nodeCall?.[2].env).toMatchObject({
    ELECTRON_RUN_AS_NODE: '1',
    RUNTIME_PROBE_SENTINEL: 'preserved',
    PATH: process.env.PATH,
  });
  for (const [executable, , options] of mocks.spawn.mock.calls) {
    if (executable !== mocks.electron) expect(options.env).toBeUndefined();
  }
  expect(process.env.ELECTRON_RUN_AS_NODE).toBe('0');
});
