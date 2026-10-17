/** Core store access and enterprise session/renderer bridge IPC handlers. */
import { ipcMain } from 'electron';

import { isEnterprise } from './appEnv';
import { getStore } from './runtimeServices';
import { refreshEndpointsTestMode } from '../libs/endpoints';
import { EnterpriseSessionIpc } from '../../shared/enterpriseSession';
import { EnterpriseRendererIpc } from '../../shared/enterpriseRenderer';
import {
  ZHIYUAN_ENTERPRISE_RENDERER_SCHEME,
  zhiyuanEnterpriseRendererBridge,
} from '../enterpriseExtension/rendererBridge';
import { zhiyuanEnterpriseSessionBridge } from '../enterpriseExtension/sessionBridge';

export const registerCoreIpc = (): void => {
  ipcMain.handle('store:get', (_event, key) => {
    return getStore().get(key);
  });

  ipcMain.handle('store:set', async (_event, key, value) => {
    getStore().set(key, value);
    if (key === 'app_config') {
      refreshEndpointsTestMode(getStore());
    }
  });

  ipcMain.handle('store:remove', (_event, key) => {
    getStore().delete(key);
  });

  ipcMain.handle('enterprise:getConfig', async () => {
    try {
      return getStore().get('enterprise_config') ?? null;
    } catch {
      return null;
    }
  });
  ipcMain.handle(EnterpriseSessionIpc.Snapshot, () => zhiyuanEnterpriseSessionBridge.snapshot());
  ipcMain.handle(EnterpriseSessionIpc.Login, (_event, input: unknown) =>
    zhiyuanEnterpriseSessionBridge.login(input),
  );
  ipcMain.handle(EnterpriseSessionIpc.ChangePassword, (_event, input: unknown) =>
    zhiyuanEnterpriseSessionBridge.changePassword(input),
  );
  ipcMain.handle(EnterpriseSessionIpc.Logout, () => zhiyuanEnterpriseSessionBridge.logout());
  ipcMain.handle(EnterpriseRendererIpc.SessionGateEntrypoint, () =>
    zhiyuanEnterpriseRendererBridge.sessionGateEntrypoint(),
  );
  ipcMain.handle(EnterpriseRendererIpc.SettingsPages, () =>
    zhiyuanEnterpriseRendererBridge.settingsPages(),
  );
};
