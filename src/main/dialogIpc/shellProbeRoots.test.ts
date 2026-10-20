import { describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/os/${name}`),
    getAppPath: vi.fn(() => '/app'),
  },
  BrowserWindow: {},
  dialog: {},
  ipcMain: { handle: vi.fn() },
}));

import { getAllowedShellProbeRoots } from './index';

const getCoworkStore = () =>
  ({ listWorkspaces: () => [{ path: '/ws/cowork' }] }) as never;

describe('getAllowedShellProbeRoots', () => {
  test('includes coding workspace roots alongside cowork and standard roots', () => {
    const roots = getAllowedShellProbeRoots(getCoworkStore, () => [
      '/ws/coding-a',
      '/ws/coding-b',
    ]);
    expect(roots).toContain('/ws/coding-a');
    expect(roots).toContain('/ws/coding-b');
    expect(roots).toContain('/ws/cowork');
    expect(roots).toContain('/app');
    expect(roots).toContain(process.cwd());
  });

  test('is backward compatible without the coding provider', () => {
    const roots = getAllowedShellProbeRoots(getCoworkStore);
    expect(roots).toContain('/ws/cowork');
  });
});
