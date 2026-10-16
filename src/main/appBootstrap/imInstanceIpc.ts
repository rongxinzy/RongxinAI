/** IM per-instance IPC: DingTalk / QQ / Feishu / WeCom / Telegram / Discord add & delete. */
import fs from 'fs';
import path from 'path';

import { ipcMain } from 'electron';

import { rt } from './runtimeState';
import { getIMGatewayManager } from './ccConnectRuntime';
import { scheduleImConfigSync } from './imGatewayIpc';
import type {
  DingTalkInstanceConfig,
  DiscordInstanceConfig,
  FeishuInstanceConfig,
  QQInstanceConfig,
  TelegramInstanceConfig,
  WecomInstanceConfig,
} from '../im';
import type { Platform } from '../../shared/platform';

export const registerImInstanceIpc = (): void => {
  ipcMain.handle('im:dingtalk:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_DINGTALK_CHANNEL_CONFIG: defaults } = await import('../im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'DingTalk Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setDingTalkInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add DingTalk instance',
      };
    }
  });

  ipcMain.handle('im:dingtalk:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteDingTalkInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete DingTalk instance',
      };
    }
  });

  ipcMain.handle(
    'im:dingtalk:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<DingTalkInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setDingTalkInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set DingTalk instance config',
        };
      }
    },
  );

  // QQ Multi-Instance handlers
  ipcMain.handle('im:qq:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_QQ_CONFIG: defaults } = await import('../im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'QQ Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setQQInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add QQ instance',
      };
    }
  });

  ipcMain.handle('im:qq:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteQQInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete QQ instance',
      };
    }
  });

  ipcMain.handle(
    'im:qq:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<QQInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setQQInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set QQ instance config',
        };
      }
    },
  );

  // Feishu Multi-Instance handlers
  ipcMain.handle('im:feishu:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_FEISHU_CHANNEL_CONFIG: defaults } = await import('../im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Feishu Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setFeishuInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Feishu instance',
      };
    }
  });

  ipcMain.handle('im:feishu:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteFeishuInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Feishu instance',
      };
    }
  });

  ipcMain.handle(
    'im:feishu:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<FeishuInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setFeishuInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set Feishu instance config',
        };
      }
    },
  );

  // WeCom Multi-Instance handlers
  ipcMain.handle('im:wecom:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_WECOM_CONFIG: defaults } = await import('../im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'WeCom Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setWecomInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add WeCom instance',
      };
    }
  });

  ipcMain.handle('im:wecom:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteWecomInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete WeCom instance',
      };
    }
  });

  ipcMain.handle(
    'im:wecom:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<WecomInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setWecomInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set WeCom instance config',
        };
      }
    },
  );

  // Telegram Multi-Instance handlers
  ipcMain.handle('im:telegram:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_TELEGRAM_CHANNEL_CONFIG: defaults } = await import('../im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Telegram Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setTelegramInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Telegram instance',
      };
    }
  });

  ipcMain.handle('im:telegram:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteTelegramInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Telegram instance',
      };
    }
  });

  ipcMain.handle(
    'im:telegram:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<TelegramInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setTelegramInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set Telegram instance config',
        };
      }
    },
  );

  // Discord Multi-Instance handlers
  ipcMain.handle('im:discord:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_DISCORD_CHANNEL_CONFIG: defaults } = await import('../im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Discord Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setDiscordInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Discord instance',
      };
    }
  });

  ipcMain.handle('im:discord:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteDiscordInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Discord instance',
      };
    }
  });

  ipcMain.handle(
    'im:discord:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<DiscordInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setDiscordInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set Discord instance config',
        };
      }
    },
  );

  ipcMain.handle(
    'feishu:install:verify',
    async (_event, { appId, appSecret }: { appId: string; appSecret: string }) => {
      try {
        return await getIMGatewayManager().verifyFeishuCredentials(appId, appSecret);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '验证失败' };
      }
    },
  );

  // DingTalk bot install helpers
};
