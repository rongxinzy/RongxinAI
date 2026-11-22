import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { expect, test, vi } from 'vitest';

import { appSystemContract } from '../../../shared/ipc/appSystemContract';
import { registerIntegrationsIpc } from './index';

test('readiness calls the configured model readiness dependency on each invocation', async () => {
  using registration = vi.spyOn(ipcMain, 'handle');
  const checkApiConfig = vi
    .fn()
    .mockResolvedValueOnce({ hasConfig: false, config: null })
    .mockResolvedValueOnce({ hasConfig: true, config: null });
  registerIntegrationsIpc({
    isInternalWorkspacePath: vi.fn(),
    getCoworkStore: vi.fn(),
    checkApiConfig,
  });
  const handler = registration.mock.calls.find(
    ([channel]) => channel === appSystemContract.checkApiConfig.channel,
  )![1];
  const invoke = () => handler({} as IpcMainInvokeEvent);
  await expect(invoke()).resolves.toEqual({ hasConfig: false, config: null });
  await expect(invoke()).resolves.toEqual({ hasConfig: true, config: null });
  expect(checkApiConfig).toHaveBeenCalledTimes(2);
});
