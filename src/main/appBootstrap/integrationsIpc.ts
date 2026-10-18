/** Integration IPC: DingTalk install plus session title, recent cwds and readiness helpers. */
import { ipcMain } from 'electron';

import { getIMGatewayManager } from './ccConnectRuntime';
import { getMagpieModelService } from './magpieRuntime';
import { generateSessionTitle } from '../libs/coworkUtil';
import { isInternalWorkspacePath } from './workspacePaths';
import { getCoworkStore } from './runtimeServices';
import { t } from '../i18n';
import { AppConfigIpc, DingTalkInstallIpc } from '../../shared/ipc/channels';

export const registerIntegrationsIpc = (): void => {
  const modelService = getMagpieModelService();
  ipcMain.handle(DingTalkInstallIpc.Qrcode, async () => {
    try {
      return await getIMGatewayManager().startDingTalkInstallQrcode();
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '获取二维码失败');
    }
  });

  ipcMain.handle(
    DingTalkInstallIpc.Poll,
    async (_event, { deviceCode }: { deviceCode: string }) => {
      try {
        return await getIMGatewayManager().pollDingTalkInstall(deviceCode);
      } catch (error) {
        return { done: false, error: error instanceof Error ? error.message : '轮询失败' };
      }
    },
  );

  ipcMain.handle(
    DingTalkInstallIpc.Verify,
    async (_event, { clientId, clientSecret }: { clientId: string; clientSecret: string }) => {
      try {
        return await getIMGatewayManager().verifyDingTalkCredentials(clientId, clientSecret);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '验证失败' };
      }
    },
  );

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
