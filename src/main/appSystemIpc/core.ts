/** Core store access and enterprise session/renderer bridge IPC handlers. */
import { appSystemContract } from '../../shared/ipc/appSystemContract';
import { providersContract } from '../../shared/ipc/providersContract';
import type { SqliteStore } from '../sqliteStore';
import { handleIpcContractSubset } from '../ipc/handleIpcContract';
import { refreshEndpointsTestMode } from '../libs/endpoints';
import { zhiyuanEnterpriseRendererBridge } from '../enterpriseExtension/rendererBridge';
import { zhiyuanEnterpriseSessionBridge } from '../enterpriseExtension/sessionBridge';

export interface CoreIpcDeps {
  getStore: () => SqliteStore;
}

export const registerCoreIpc = (deps: CoreIpcDeps): void => {
  handleIpcContractSubset(appSystemContract, {
    storeGet: (_event, key) => deps.getStore().get(key),
    // app_config writes must re-resolve endpoint test mode alongside the set.
    storeSet: (_event, key, value) => {
      deps.getStore().set(key, value);
      if (key === 'app_config') {
        refreshEndpointsTestMode(deps.getStore());
      }
    },
    storeRemove: (_event, key) => {
      deps.getStore().delete(key);
    },
  });

  handleIpcContractSubset(providersContract, {
    enterpriseGetConfig: () => {
      try {
        return deps.getStore().get('enterprise_config') ?? null;
      } catch {
        return null;
      }
    },
    enterpriseSessionGateEntrypoint: () => zhiyuanEnterpriseRendererBridge.sessionGateEntrypoint(),
    enterpriseSettingsPages: () => zhiyuanEnterpriseRendererBridge.settingsPages(),
    enterpriseSessionSnapshot: () => zhiyuanEnterpriseSessionBridge.snapshot(),
    enterpriseSessionLogin: (_event, input) => zhiyuanEnterpriseSessionBridge.login(input),
    enterpriseSessionChangePassword: (_event, input) =>
      zhiyuanEnterpriseSessionBridge.changePassword(input),
    enterpriseSessionLogout: () => zhiyuanEnterpriseSessionBridge.logout(),
  });
};
