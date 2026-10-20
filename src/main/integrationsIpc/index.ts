/** Integration IPC: DingTalk install plus session title, recent cwds and readiness helpers. */
import { generateSessionTitle } from '../libs/coworkUtil';
import { t } from '../i18n';
import { appSystemContract } from '../../shared/ipc/appSystemContract';
import type { MagpieModelService } from '../magpie/modelService';
import type { ChannelAccountManager } from '../im/channelAccountManager';
import type { CoworkStore } from '../coworkStore';
import { handleIpcContract, handleIpcContractSubset } from '../ipc/handleIpcContract';
import { dingtalkInstallContract } from '../../shared/ipc/imContract';

export interface IntegrationsIpcDeps {
  getIMGatewayManager: () => ChannelAccountManager;
  getMagpieModelService: () => MagpieModelService | undefined;
  isInternalWorkspacePath: (candidate: string) => boolean;
  getCoworkStore: () => CoworkStore;
}

export const registerIntegrationsIpc = (deps: IntegrationsIpcDeps): void => {
  const modelService = deps.getMagpieModelService();
  handleIpcContract(dingtalkInstallContract, {
    qrcode: async () => {
      try {
        return await deps.getIMGatewayManager().startDingTalkInstallQrcode();
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : '获取二维码失败');
      }
    },

    poll: async (_event, { deviceCode }) => {
      try {
        return await deps.getIMGatewayManager().pollDingTalkInstall(deviceCode);
      } catch (error) {
        return { done: false, error: error instanceof Error ? error.message : '轮询失败' };
      }
    },

    verify: async (_event, { clientId, clientSecret }) => {
      try {
        return await deps.getIMGatewayManager().verifyDingTalkCredentials(clientId, clientSecret);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '验证失败' };
      }
    },
  });

  handleIpcContractSubset(appSystemContract, {
    generateSessionTitle: async (_event, userInput) => {
      return generateSessionTitle(userInput, t('coworkDefaultSessionTitle'));
    },

    getRecentCwds: async (_event, limit) => {
      const boundedLimit = limit ? Math.min(Math.max(limit, 1), 20) : 8;
      return deps
        .getCoworkStore()
        .listRecentCwds(20)
        .filter(cwd => !deps.isInternalWorkspacePath(cwd))
        .slice(0, boundedLimit);
    },

    checkApiConfig: async () => modelService.checkReadiness(),
  });
};
