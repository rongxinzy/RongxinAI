/** Integration IPC: DingTalk install plus session title, recent cwds and readiness helpers. */
import { ipcMain } from 'electron';

import { getIMGatewayManager } from './ccConnectRuntime';
import { getMagpieModelService } from './magpieRuntime';
import { generateSessionTitle } from '../libs/coworkUtil';
import { isInternalWorkspacePath } from './workspacePaths';
import { getCoworkStore } from './runtimeServices';
import { t } from '../i18n';
import { AppConfigIpc } from '../../shared/ipc/channels';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { dingtalkInstallContract } from '../../shared/ipc/imContract';

export const registerIntegrationsIpc = (): void => {
  const modelService = getMagpieModelService();
  handleIpcContract(dingtalkInstallContract, {
    qrcode: async () => {
      try {
        return await getIMGatewayManager().startDingTalkInstallQrcode();
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : '获取二维码失败');
      }
    },

    poll: async (_event, { deviceCode }) => {
      try {
        return await getIMGatewayManager().pollDingTalkInstall(deviceCode);
      } catch (error) {
        return { done: false, error: error instanceof Error ? error.message : '轮询失败' };
      }
    },

    verify: async (_event, { clientId, clientSecret }) => {
      try {
        return await getIMGatewayManager().verifyDingTalkCredentials(clientId, clientSecret);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '验证失败' };
      }
    },
  });

  ipcMain.handle(AppConfigIpc.GenerateSessionTitle, async (_event, userInput: string | null) => {
    return generateSessionTitle(userInput, t('coworkDefaultSessionTitle'));
  });

  ipcMain.handle(AppConfigIpc.GetRecentCwds, async (_event, limit?: number) => {
    const boundedLimit = limit ? Math.min(Math.max(limit, 1), 20) : 8;
    return getCoworkStore()
      .listRecentCwds(20)
      .filter(cwd => !isInternalWorkspacePath(cwd))
      .slice(0, boundedLimit);
  });

  ipcMain.handle(AppConfigIpc.CheckApiConfig, () => modelService.checkReadiness());
};
