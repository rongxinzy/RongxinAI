/** IM gateway IPC: config get/sync (debounced sidecar reconcile), gateway start/stop, local IP. */
import type { ChannelAccountManager } from '../im/channelAccountManager';
import type { CcConnectAccountRuntimeStatus } from '../libs/ccConnectRuntimeStatusRegistry';

export interface ImGatewayIpcDeps {
  getIMGatewayManager: () => ChannelAccountManager;
  reconcileCcConnectChannelSidecars: () => Promise<void>;
  refreshCcConnectPlatformStatuses: () => Promise<void>;
  resolveCcConnectSidecarExecutable: () => string | null;
  resolveCcConnectAccountRuntimeStatus: (accountId: string) => CcConnectAccountRuntimeStatus;
}

import os from 'os';

import { type IMGatewayConfigPatch, sanitizeRendererIMConfigPatch } from '../im/configPatch';
import { IMGatewayConfig } from '../im';
import {
  formatWeixinSetupErrorForLog,
  isWeixinSetupTransportError,
  runCcConnectWeixinSetup,
} from '../libs/ccConnectWeixinSetup';
import type { Platform } from '../../shared/platform';
import { WeixinLoginErrorCode } from '../../shared/ipc/channels';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { imContract } from '../../shared/ipc/imContract';

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

const doImConfigSync = async (reconcile: () => Promise<void>) => {
  imConfigSyncRunning = true;
  try {
    await reconcile();
  } catch (error) {
    console.error('[IM] Sidecar reconciliation failed:', error);
  } finally {
    imConfigSyncRunning = false;
    if (imConfigSyncPending) {
      imConfigSyncPending = false;
      scheduleImConfigSync(reconcile);
    }
  }
};

export const scheduleImConfigSync = (reconcile: () => Promise<void>) => {
  if (imConfigSyncRunning) {
    // A sync is already in progress; mark pending so it re-runs after completion.
    imConfigSyncPending = true;
    return;
  }
  if (imConfigSyncTimer) clearTimeout(imConfigSyncTimer);
  imConfigSyncTimer = setTimeout(() => {
    imConfigSyncTimer = null;
    void doImConfigSync(reconcile);
  }, IM_CONFIG_SYNC_DEBOUNCE_MS);
};

const reconcileImConfigImmediately = async (reconcile: () => Promise<void>): Promise<void> => {
  if (imConfigSyncTimer) clearTimeout(imConfigSyncTimer);
  imConfigSyncTimer = null;
  imConfigSyncPending = false;
  await reconcile();
};

export const registerImGatewayIpc = (deps: ImGatewayIpcDeps): void => {
  handleIpcContract(imContract, {
    getConfig: async () => {
      try {
        const config = deps.getIMGatewayManager().getConfig();
        return { success: true, config };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get IM config',
        };
      }
    },

    setConfig: async (
      _event,
      config: IMGatewayConfigPatch,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        const sanitizedConfig = sanitizeRendererIMConfigPatch(config);
        deps.getIMGatewayManager().setConfig(sanitizedConfig, {
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
          scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set IM config',
        };
      }
    },

    // Apply persisted channel configuration to cc-connect sidecars.
    syncConfig: async () => {
      try {
        await deps.reconcileCcConnectChannelSidecars();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to sync IM config',
        };
      }
    },

    startGateway: async (_event, platform: Platform) => {
      try {
        // Persist enabled state
        const manager = deps.getIMGatewayManager();
        manager.setConfig({ [platform]: { enabled: true } });
        await deps.reconcileCcConnectChannelSidecars();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start gateway',
        };
      }
    },

    stopGateway: async (_event, platform: Platform) => {
      try {
        // Persist disabled state
        const manager = deps.getIMGatewayManager();
        manager.setConfig({ [platform]: { enabled: false } });
        await deps.reconcileCcConnectChannelSidecars();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to stop gateway',
        };
      }
    },

    weixinLoginStart: async () => {
      try {
        const executable = deps.resolveCcConnectSidecarExecutable();
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
    },

    weixinLoginPoll: async (
      _event,
      qrcode: string,
    ): Promise<{
      success: boolean;
      status: 'wait' | 'scaned' | 'confirmed' | 'expired';
      accountId?: string;
      errorCode?: string;
    }> => {
      try {
        if (!qrcode?.trim()) throw new Error('Weixin QR code is required');
        const executable = deps.resolveCcConnectSidecarExecutable();
        if (!executable) throw new Error('Channel runtime is not bundled');
        const result = await runCcConnectWeixinSetup(executable, 'poll', qrcode);
        if (result.status === 'confirmed') {
          if (!result.accountId || !result.botToken || !result.baseUrl) {
            throw new Error('Weixin login result is incomplete');
          }
          deps.getIMGatewayManager().setConfig({
            weixin: {
              ...deps.getIMGatewayManager().getConfig().weixin,
              enabled: true,
              accountId: result.accountId,
              token: result.botToken,
              baseUrl: result.baseUrl,
            },
          });
          await reconcileImConfigImmediately(deps.reconcileCcConnectChannelSidecars);
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
    },

    testGateway: async (
      _event,
      platform: Platform,
      configOverride?: Partial<IMGatewayConfig>,
      accountId?: string,
    ) => {
      try {
        const result = await deps
          .getIMGatewayManager()
          .testGateway(platform, configOverride, accountId);
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to test gateway connectivity',
        };
      }
    },

    getStatus: async () => {
      try {
        await deps.refreshCcConnectPlatformStatuses();
        const status = deps
          .getIMGatewayManager()
          .getStatus(instanceId => deps.resolveCcConnectAccountRuntimeStatus(instanceId));
        return { success: true, status };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get IM status',
        };
      }
    },

    getLocalIp: () => {
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          if (net.family === 'IPv4' && !net.internal) {
            return net.address;
          }
        }
      }
      return '127.0.0.1';
    },
  });
};
