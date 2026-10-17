import { ipcRenderer } from 'electron';

import {
  DingTalkInstallIpc,
  FeishuInstallIpc,
  ImIpc,
  ImInstanceIpc,
  WeixinInstallIpc,
} from '../../shared/ipc/channels';
import type { Platform } from '../../shared/platform';
import { onPush } from './pushChannel';

// IM gateways, login/install flows, and per-platform instances.
export const imApi = {
  im: {
    getConfig: () => ipcRenderer.invoke(ImIpc.ConfigGet),
    setConfig: (config: unknown, options?: { syncGateway?: boolean }) =>
      ipcRenderer.invoke(ImIpc.ConfigSet, config, options),
    syncConfig: () => ipcRenderer.invoke(ImIpc.ConfigSync),

    startGateway: (platform: Platform) => ipcRenderer.invoke(ImIpc.GatewayStart, platform),
    stopGateway: (platform: Platform) => ipcRenderer.invoke(ImIpc.GatewayStop, platform),
    testGateway: (platform: Platform, configOverride?: unknown, accountId?: string) =>
      ipcRenderer.invoke(ImIpc.GatewayTest, platform, configOverride, accountId),

    getStatus: () => ipcRenderer.invoke(ImIpc.StatusGet),
    getLocalIp: () => ipcRenderer.invoke(ImIpc.GetLocalIp) as Promise<string>,
    weixinLoginStart: () => ipcRenderer.invoke(WeixinInstallIpc.Start),
    weixinLoginPoll: (qrcode: string) => ipcRenderer.invoke(WeixinInstallIpc.Poll, qrcode),
    // Multi-Instance
    addDingTalkInstance: (name: string, workspaceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.dingtalkAdd, name, workspaceId),
    deleteDingTalkInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.dingtalkDelete, instanceId),
    setDingTalkInstanceConfig: (
      instanceId: string,
      config: unknown,
      options?: { syncGateway?: boolean },
    ) => ipcRenderer.invoke(ImInstanceIpc.dingtalkSetConfig, instanceId, config, options),

    addQQInstance: (name: string, workspaceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.qqAdd, name, workspaceId),
    deleteQQInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.qqDelete, instanceId),
    setQQInstanceConfig: (
      instanceId: string,
      config: unknown,
      options?: { syncGateway?: boolean },
    ) => ipcRenderer.invoke(ImInstanceIpc.qqSetConfig, instanceId, config, options),

    addFeishuInstance: (name: string, workspaceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.feishuAdd, name, workspaceId),
    deleteFeishuInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.feishuDelete, instanceId),
    setFeishuInstanceConfig: (
      instanceId: string,
      config: unknown,
      options?: { syncGateway?: boolean },
    ) => ipcRenderer.invoke(ImInstanceIpc.feishuSetConfig, instanceId, config, options),

    addWecomInstance: (name: string, workspaceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.wecomAdd, name, workspaceId),
    deleteWecomInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.wecomDelete, instanceId),
    setWecomInstanceConfig: (
      instanceId: string,
      config: unknown,
      options?: { syncGateway?: boolean },
    ) => ipcRenderer.invoke(ImInstanceIpc.wecomSetConfig, instanceId, config, options),

    addTelegramInstance: (name: string, workspaceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.telegramAdd, name, workspaceId),
    deleteTelegramInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.telegramDelete, instanceId),
    setTelegramInstanceConfig: (
      instanceId: string,
      config: unknown,
      options?: { syncGateway?: boolean },
    ) => ipcRenderer.invoke(ImInstanceIpc.telegramSetConfig, instanceId, config, options),

    addDiscordInstance: (name: string, workspaceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.discordAdd, name, workspaceId),
    deleteDiscordInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.discordDelete, instanceId),
    setDiscordInstanceConfig: (
      instanceId: string,
      config: unknown,
      options?: { syncGateway?: boolean },
    ) => ipcRenderer.invoke(ImInstanceIpc.discordSetConfig, instanceId, config, options),

    onStatusChange: (callback: (status: unknown) => void) => onPush(ImIpc.StatusChange, callback),
    onMessageReceived: (callback: (message: unknown) => void) =>
      onPush(ImIpc.MessageReceived, callback),
  },

  feishu: {
    install: {
      verify: (appId: string, appSecret: string) =>
        ipcRenderer.invoke(FeishuInstallIpc.Verify, { appId, appSecret }),
    },
  },

  dingtalk: {
    install: {
      qrcode: () => ipcRenderer.invoke(DingTalkInstallIpc.Qrcode),
      poll: (deviceCode: string) => ipcRenderer.invoke(DingTalkInstallIpc.Poll, { deviceCode }),
      verify: (clientId: string, clientSecret: string) =>
        ipcRenderer.invoke(DingTalkInstallIpc.Verify, { clientId, clientSecret }),
    },
  },
};
