import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { shell } from 'electron';

import { handleIpcContractSubset } from '../ipc/handleIpcContract';
import type { CoworkStore } from '../coworkStore';
import { registerShellIpc } from './index';

vi.mock('../ipc/handleIpcContract', () => ({ handleIpcContractSubset: vi.fn() }));

interface ShellHandlers {
  shellOpenExternal(event: unknown, url: string): Promise<{ success: boolean; error?: string }>;
  shellOpenHtmlInBrowser(
    event: unknown,
    html: string,
  ): Promise<{ success: boolean; error?: string }>;
}

function handlers(): ShellHandlers {
  const call = vi.mocked(handleIpcContractSubset).mock.calls.at(-1);
  if (!call) throw new Error('Shell IPC was not registered');
  return call[1] as unknown as ShellHandlers;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(shell, 'openExternal').mockResolvedValue(undefined);
  vi.spyOn(shell, 'openPath').mockResolvedValue('');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('defense blocks system browser and external HTML navigation', async () => {
  vi.stubEnv('APP_EDITION', 'defense');
  registerShellIpc({ getCoworkStore: () => null as unknown as CoworkStore });

  await expect(handlers().shellOpenExternal({}, 'https://example.com')).resolves.toEqual({
    success: false,
    error: 'Access denied',
  });
  await expect(handlers().shellOpenHtmlInBrowser({}, '<html></html>')).resolves.toEqual({
    success: false,
    error: 'Access denied',
  });
  expect(shell.openExternal).not.toHaveBeenCalled();
  expect(shell.openPath).not.toHaveBeenCalled();
});

test('regular edition retains external HTTPS navigation', async () => {
  vi.stubEnv('APP_EDITION', 'zhiyuan');
  registerShellIpc({ getCoworkStore: () => null as unknown as CoworkStore });

  await expect(handlers().shellOpenExternal({}, 'https://example.com')).resolves.toEqual({
    success: true,
  });
  expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com');
});
