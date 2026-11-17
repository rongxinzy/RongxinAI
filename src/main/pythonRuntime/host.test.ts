import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  exists: vi.fn(),
  root: vi.fn(),
  options: [] as Array<Record<string, unknown>>,
}));
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/profile', getAppPath: () => '/app' },
}));
vi.mock('node:fs', () => ({ existsSync: mocked.exists }));
vi.mock('../libs/pythonRuntime', () => ({ getBundledPythonRoot: mocked.root }));
vi.mock('./service', () => ({
  PythonRuntimeService: class {
    constructor(options: Record<string, unknown>) {
      mocked.options.push(options);
    }
    async shutdown() {}
  },
}));
import { getPythonRuntimeService, shutdownPythonRuntime } from './host';

beforeEach(() => {
  mocked.options.length = 0;
  mocked.exists.mockReset().mockReturnValue(true);
  mocked.root.mockReset().mockReturnValue('/bundle/resources/python-host');
});
afterEach(shutdownPythonRuntime);

test('workspace Python resolves the interpreter, uv and dependency baseline from one bundled root', () => {
  expect(getPythonRuntimeService()).toBe(getPythonRuntimeService());
  expect(mocked.options).toHaveLength(1);
  const platform =
    process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  expect(mocked.options[0].preinstalledRuntime).toEqual({
    pythonPath: path.join(
      '/bundle/resources/python-host',
      platform === 'win' ? 'python.exe' : 'bin/python3',
    ),
    uvPath: path.join('/bundle/resources', `uv-${platform}`, platform === 'win' ? 'uv.exe' : 'uv'),
    sharedPythonPath: path.join(
      '/bundle/resources/skill-python/layers/shared',
      platform === 'win' ? 'Scripts/python.exe' : 'bin/python',
    ),
    runtimeId: 'bundled-cpython-3.14.6-uv-0.11.32',
  });
});

test('a partial bundle is unavailable instead of silently selecting another Python environment', () => {
  mocked.exists.mockImplementation((file: string) => !file.includes('skill-python'));
  getPythonRuntimeService();
  expect(mocked.options[0].preinstalledRuntime).toBeUndefined();
});
