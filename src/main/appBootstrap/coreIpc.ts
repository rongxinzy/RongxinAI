/** Core store access and enterprise session/renderer bridge IPC handlers. */
import { appSystemContract } from '../../shared/ipc/appSystemContract';
import { providersContract } from '../../shared/ipc/providersContract';
import { handleIpcContractSubset } from '../ipc/handleIpcContract';
import { getStore } from './runtimeServices';
import { refreshEndpointsTestMode } from '../libs/endpoints';
import { zhiyuanEnterpriseRendererBridge } from '../enterpriseExtension/rendererBridge';
import { zhiyuanEnterpriseSessionBridge } from '../enterpriseExtension/sessionBridge';

export const registerCoreIpc = (): void => {
  handleIpcContractSubset(appSystemContract, {
    storeGet: (_event, key) => getStore().get(key),
    // app_config writes must re-resolve endpoint test mode alongside the set.
    storeSet: (_event, key, value) => {
      getStore().set(key, value);
      if (key === 'app_config') {
        refreshEndpointsTestMode(getStore());
      }
    },
    storeRemove: (_event, key) => {
      getStore().delete(key);
    },
  });

  handleIpcContractSubset(providersContract, {
    enterpriseGetConfig: () => {
      try {
        return getStore().get('enterprise_config') ?? null;
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
