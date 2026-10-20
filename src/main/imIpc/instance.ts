/** IM per-instance IPC: DingTalk / QQ / Feishu / WeCom / Telegram / Discord add & delete. */
import type {
  DingTalkInstanceConfig,
  DiscordInstanceConfig,
  FeishuInstanceConfig,
  QQInstanceConfig,
  TelegramInstanceConfig,
  WecomInstanceConfig,
} from '../im';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { feishuInstallContract, imInstanceContract } from '../../shared/ipc/imContract';

import { scheduleImConfigSync } from './gateway';

import type { ChannelAccountManager } from '../im/channelAccountManager';

export interface ImInstanceIpcDeps {
  getIMGatewayManager: () => ChannelAccountManager;
  reconcileCcConnectChannelSidecars: () => Promise<void>;
}

export const registerImInstanceIpc = (deps: ImInstanceIpcDeps): void => {
  handleIpcContract(imInstanceContract, {
    addDingTalkInstance: async (_event, name: string, workspaceId: string) => {
      try {
        const instanceId = crypto.randomUUID();
        const { DEFAULT_DINGTALK_CHANNEL_CONFIG: defaults } = await import('../im/types.js');
        const instance = {
          ...defaults,
          instanceId,
          instanceName: name || 'DingTalk Bot',
          workspaceId,
        };
        deps.getIMGatewayManager().getIMStore().setDingTalkInstanceConfig(instanceId, instance);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true, instance };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add DingTalk instance',
        };
      }
    },

    deleteDingTalkInstance: async (_event, instanceId: string) => {
      try {
        deps.getIMGatewayManager().getIMStore().deleteDingTalkInstance(instanceId);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete DingTalk instance',
        };
      }
    },

    setDingTalkInstanceConfig: async (
      _event,
      instanceId: string,
      config: Partial<DingTalkInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        deps.getIMGatewayManager().getIMStore().setDingTalkInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set DingTalk instance config',
        };
      }
    },

    // QQ Multi-Instance handlers
    addQQInstance: async (_event, name: string, workspaceId: string) => {
      try {
        const instanceId = crypto.randomUUID();
        const { DEFAULT_QQ_CONFIG: defaults } = await import('../im/types.js');
        const instance = {
          ...defaults,
          instanceId,
          instanceName: name || 'QQ Bot',
          workspaceId,
        };
        deps.getIMGatewayManager().getIMStore().setQQInstanceConfig(instanceId, instance);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true, instance };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add QQ instance',
        };
      }
    },

    deleteQQInstance: async (_event, instanceId: string) => {
      try {
        deps.getIMGatewayManager().getIMStore().deleteQQInstance(instanceId);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete QQ instance',
        };
      }
    },

    setQQInstanceConfig: async (
      _event,
      instanceId: string,
      config: Partial<QQInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        deps.getIMGatewayManager().getIMStore().setQQInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set QQ instance config',
        };
      }
    },

    // Feishu Multi-Instance handlers
    addFeishuInstance: async (_event, name: string, workspaceId: string) => {
      try {
        const instanceId = crypto.randomUUID();
        const { DEFAULT_FEISHU_CHANNEL_CONFIG: defaults } = await import('../im/types.js');
        const instance = {
          ...defaults,
          instanceId,
          instanceName: name || 'Feishu Bot',
          workspaceId,
        };
        deps.getIMGatewayManager().getIMStore().setFeishuInstanceConfig(instanceId, instance);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true, instance };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add Feishu instance',
        };
      }
    },

    deleteFeishuInstance: async (_event, instanceId: string) => {
      try {
        deps.getIMGatewayManager().getIMStore().deleteFeishuInstance(instanceId);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete Feishu instance',
        };
      }
    },

    setFeishuInstanceConfig: async (
      _event,
      instanceId: string,
      config: Partial<FeishuInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        deps.getIMGatewayManager().getIMStore().setFeishuInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set Feishu instance config',
        };
      }
    },

    // WeCom Multi-Instance handlers
    addWecomInstance: async (_event, name: string, workspaceId: string) => {
      try {
        const instanceId = crypto.randomUUID();
        const { DEFAULT_WECOM_CONFIG: defaults } = await import('../im/types.js');
        const instance = {
          ...defaults,
          instanceId,
          instanceName: name || 'WeCom Bot',
          workspaceId,
        };
        deps.getIMGatewayManager().getIMStore().setWecomInstanceConfig(instanceId, instance);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true, instance };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add WeCom instance',
        };
      }
    },

    deleteWecomInstance: async (_event, instanceId: string) => {
      try {
        deps.getIMGatewayManager().getIMStore().deleteWecomInstance(instanceId);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete WeCom instance',
        };
      }
    },

    setWecomInstanceConfig: async (
      _event,
      instanceId: string,
      config: Partial<WecomInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        deps.getIMGatewayManager().getIMStore().setWecomInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set WeCom instance config',
        };
      }
    },

    // Telegram Multi-Instance handlers
    addTelegramInstance: async (_event, name: string, workspaceId: string) => {
      try {
        const instanceId = crypto.randomUUID();
        const { DEFAULT_TELEGRAM_CHANNEL_CONFIG: defaults } = await import('../im/types.js');
        const instance = {
          ...defaults,
          instanceId,
          instanceName: name || 'Telegram Bot',
          workspaceId,
        };
        deps.getIMGatewayManager().getIMStore().setTelegramInstanceConfig(instanceId, instance);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true, instance };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add Telegram instance',
        };
      }
    },

    deleteTelegramInstance: async (_event, instanceId: string) => {
      try {
        deps.getIMGatewayManager().getIMStore().deleteTelegramInstance(instanceId);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete Telegram instance',
        };
      }
    },

    setTelegramInstanceConfig: async (
      _event,
      instanceId: string,
      config: Partial<TelegramInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        deps.getIMGatewayManager().getIMStore().setTelegramInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set Telegram instance config',
        };
      }
    },

    // Discord Multi-Instance handlers
    addDiscordInstance: async (_event, name: string, workspaceId: string) => {
      try {
        const instanceId = crypto.randomUUID();
        const { DEFAULT_DISCORD_CHANNEL_CONFIG: defaults } = await import('../im/types.js');
        const instance = {
          ...defaults,
          instanceId,
          instanceName: name || 'Discord Bot',
          workspaceId,
        };
        deps.getIMGatewayManager().getIMStore().setDiscordInstanceConfig(instanceId, instance);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true, instance };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add Discord instance',
        };
      }
    },

    deleteDiscordInstance: async (_event, instanceId: string) => {
      try {
        deps.getIMGatewayManager().getIMStore().deleteDiscordInstance(instanceId);
        scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete Discord instance',
        };
      }
    },

    setDiscordInstanceConfig: async (
      _event,
      instanceId: string,
      config: Partial<DiscordInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        deps.getIMGatewayManager().getIMStore().setDiscordInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync(deps.reconcileCcConnectChannelSidecars);
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set Discord instance config',
        };
      }
    },
  });

  // feishu:install:verify lives in this registration unit as well.
  handleIpcContract(feishuInstallContract, {
    verify: async (_event, { appId, appSecret }) => {
      try {
        return await deps.getIMGatewayManager().verifyFeishuCredentials(appId, appSecret);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '验证失败' };
      }
    },
  });
};
