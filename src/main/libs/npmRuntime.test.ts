import path from 'path';

import { expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn<(filePath: string) => boolean>(),
}));

Object.defineProperty(process, 'resourcesPath', {
  configurable: true,
  value: 'C:\\Program Files\\ZhiYuan Agent\\resources',
});

vi.mock('electron', () => ({
  app: {
    getAppPath: () => path.join('C:', 'Program Files', 'ZhiYuan Agent', 'resources', 'app.asar'),
    isPackaged: true,
  },
}));

vi.mock('fs', () => ({
  default: { existsSync: mocks.existsSync },
  existsSync: mocks.existsSync,
}));

vi.mock('./coworkUtil', () => ({
  getElectronNodeRuntimePath: () => 'C:\\Program Files\\ZhiYuan Agent\\ZhiYuan Agent.exe',
}));

import { NpmCli, resolveBundledNpmRuntime } from './npmRuntime';

test('uses the packaged asar npm entry point so npm dependencies remain resolvable', () => {
  mocks.existsSync.mockImplementation(filePath => filePath.includes('app.asar'));

  const runtime = resolveBundledNpmRuntime(NpmCli.Npm);

  expect(runtime).not.toBeNull();
  expect(runtime?.args[0]).toBe(
    path.join(
      'C:',
      'Program Files',
      'ZhiYuan Agent',
      'resources',
      'app.asar',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    ),
  );
  expect(runtime?.env.ELECTRON_RUN_AS_NODE).toBe('1');
});
