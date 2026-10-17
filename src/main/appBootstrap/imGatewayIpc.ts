/** IM gateway IPC: config get/sync (debounced sidecar reconcile), gateway start/stop, local IP. */
import os from 'os';

import { ipcMain } from 'electron';

import { rt } from './runtimeState';
import {
  getIMGatewayManager,
  reconcileCcConnectChannelSidecars,
  refreshCcConnectPlatformStatuses,
  resolveCcConnectSidecarExecutable,
} from './ccConnectRuntime';
import { type IMGatewayConfigPatch, sanitizeRendererIMConfigPatch } from '../im/configPatch';
import { IMGatewayConfig } from '../im';
import { resolveCcConnectAccountRuntimeStatus } from '../libs/ccConnectAccountRuntimeStatus';
import {
  formatWeixinSetupErrorForLog,
  isWeixinSetupTransportError,
  runCcConnectWeixinSetup,
} from '../libs/ccConnectWeixinSetup';
import type { Platform } from '../../shared/platform';
import { ImIpc, WeixinInstallIpc, WeixinLoginErrorCode } from '../../shared/ipc/channels';

// ==================== IM Gateway IPC Handlers ====================

// Debounce and serialize sidecar reconciliation after IM config changes.
// Rapid sequential config changes (e.g. toggling 4 platforms) are coalesced
// into a single gateway restart instead of N restarts.
// The running/pending flags prevent concurrent sync operations from racing:
// if a sync is in progress when new changes arrive, they are queued and
// a follow-up sync runs after the current one completes.
let imConfigSyncTimer: ReturnType<typeof setTimeout> | null = null;
let imConfigSyncRunning = false;
let imConfigSyncPending = false;
const IM_CONFIG_SYNC_DEBOUNCE_MS = 600;

const doImConfigSync = async () => {
  imConfigSyncRunning = true;
  try {
    await reconcileCcConnectChannelSidecars();
  } catch (error) {
    console.error('[IM] Sidecar reconciliation failed:', error);
  } finally {
    imConfigSyncRunning = false;
    if (imConfigSyncPending) {
      imConfigSyncPending = false;
      scheduleImConfigSync();
    }
  }
};

export const scheduleImConfigSync = () => {
  if (imConfigSyncRunning) {
    // A sync is already in progress; mark pending so it re-runs after completion.
    imConfigSyncPending = true;
    return;
  }
  if (imConfigSyncTimer) clearTimeout(imConfigSyncTimer);
  imConfigSyncTimer = setTimeout(() => {
    imConfigSyncTimer = null;
    void doImConfigSync();
  }, IM_CONFIG_SYNC_DEBOUNCE_MS);
};

const reconcileImConfigImmediately = async (): Promise<void> => {
  if (imConfigSyncTimer) clearTimeout(imConfigSyncTimer);
  imConfigSyncTimer = null;
  imConfigSyncPending = false;
  await reconcileCcConnectChannelSidecars();
};

export const registerImGatewayIpc = (): void => {
  ipcMain.handle('im:config:get', async () => {
    try {
      const config = getIMGatewayManager().getConfig();
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get IM config',
      };
    }
  });

  ipcMain.handle(
    ImIpc.ConfigSet,
    async (_event, config: IMGatewayConfigPatch, options?: { syncGateway?: boolean }) => {
      try {
        const sanitizedConfig = sanitizeRendererIMConfigPatch(config);
        getIMGatewayManager().setConfig(sanitizedConfig, {
          syncGateway: options?.syncGateway,
        });

        const hasChannelChange =
          sanitizedConfig.telegram ||
          sanitizedConfig.discord ||
          sanitizedConfig.dingtalk ||
          sanitizedConfig.feishu ||
          sanitizedConfig.qq ||
          sanitizedConfig.wecom ||
          sanitizedConfig.weixin;
        if (options?.syncGateway && hasChannelChange) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set IM config',
        };
      }
    },
  );

  // Apply persisted channel configuration to cc-connect sidecars.
  ipcMain.handle('im:config:sync', async () => {
    try {
      await reconcileCcConnectChannelSidecars();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync IM config',
      };
    }
  });

  ipcMain.handle('im:gateway:start', async (_event, platform: Platform) => {
    try {
      // Persist enabled state
      const manager = getIMGatewayManager();
      manager.setConfig({ [platform]: { enabled: true } });
      await reconcileCcConnectChannelSidecars();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start gateway',
      };
    }
  });

  ipcMain.handle('im:gateway:stop', async (_event, platform: Platform) => {
    try {
      // Persist disabled state
      const manager = getIMGatewayManager();
      manager.setConfig({ [platform]: { enabled: false } });
      await reconcileCcConnectChannelSidecars();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop gateway',
      };
    }
  });

  ipcMain.handle(WeixinInstallIpc.Start, async () => {
    try {
      const executable = resolveCcConnectSidecarExecutable();
      if (!executable) throw new Error('Channel runtime is not bundled');
      const result = await runCcConnectWeixinSetup(executable, 'start');
      return {
        success: true,
        status: result.status,
        qrcode: result.qrcode,
        qrcodeUrl: result.qrcodeUrl,
      };
    } catch (error) {
      const errorCode = isWeixinSetupTransportError(error)
        ? WeixinLoginErrorCode.Transport
        : WeixinLoginErrorCode.Setup;
      console.warn(
        `[WeixinLogin] QR code setup failed with ${errorCode}: ${formatWeixinSetupErrorForLog(error)}`,
      );
      return {
        success: false,
        errorCode,
      };
    }
  });

  ipcMain.handle(WeixinInstallIpc.Poll, async (_event, qrcode: string) => {
    try {
      if (!qrcode?.trim()) throw new Error('Weixin QR code is required');
      const executable = resolveCcConnectSidecarExecutable();
      if (!executable) throw new Error('Channel runtime is not bundled');
      const result = await runCcConnectWeixinSetup(executable, 'poll', qrcode);
      if (result.status === 'confirmed') {
        if (!result.accountId || !result.botToken || !result.baseUrl) {
          throw new Error('Weixin login result is incomplete');
        }
        getIMGatewayManager().setConfig({
          weixin: {
            ...getIMGatewayManager().getConfig().weixin,
            enabled: true,
            accountId: result.accountId,
            token: result.botToken,
            baseUrl: result.baseUrl,
          },
        });
        await reconcileImConfigImmediately();
      }
      return {
        success: true,
        status: result.status,
        accountId: result.status === 'confirmed' ? result.accountId : undefined,
      };
    } catch (error) {
      const errorCode = isWeixinSetupTransportError(error)
        ? WeixinLoginErrorCode.Transport
        : WeixinLoginErrorCode.Setup;
      console.warn(
        `[WeixinLogin] QR code polling failed with ${errorCode}: ${formatWeixinSetupErrorForLog(error)}`,
      );
      return {
        success: false,
        status: 'wait',
        errorCode,
      };
    }
  });

  ipcMain.handle(
    ImIpc.GatewayTest,
    async (
      _event,
      platform: Platform,
      configOverride?: Partial<IMGatewayConfig>,
      accountId?: string,
    ) => {
      try {
        const result = await getIMGatewayManager().testGateway(platform, configOverride, accountId);
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to test gateway connectivity',
        };
      }
    },
  );

  ipcMain.handle(ImIpc.StatusGet, async () => {
    try {
      await refreshCcConnectPlatformStatuses();
      const status = getIMGatewayManager().getStatus(instanceId => {
        return resolveCcConnectAccountRuntimeStatus(
          rt.ccConnectRuntimeStatuses,
          instanceId,
          rt.ccConnectSidecarManager?.running === true,
        );
      });
      return { success: true, status };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get IM status',
      };
    }
  });

  ipcMain.handle('im:getLocalIp', () => {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  });
};
