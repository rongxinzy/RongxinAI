/**
 * Channel map for the IM IPC contracts (gateway config, weixin login,
 * per-platform instances, feishu/dingtalk install), importable by the sandboxed
 * preload. Kept in a separate zod-free module because the preload bundle must
 * not require zod; the type arguments lock the maps to the contracts' channels.
 */
import type { IpcContractChannels } from './contract';
import type {
  dingtalkInstallContract,
  feishuInstallContract,
  imContract,
  imInstanceContract,
} from './imContract';
import {
  DingTalkInstallIpc,
  FeishuInstallIpc,
  ImIpc,
  ImInstanceIpc,
  WeixinInstallIpc,
} from './channels';

export const imContractChannels: IpcContractChannels<typeof imContract> = {
  getConfig: ImIpc.ConfigGet,
  setConfig: ImIpc.ConfigSet,
  syncConfig: ImIpc.ConfigSync,
  startGateway: ImIpc.GatewayStart,
  stopGateway: ImIpc.GatewayStop,
  testGateway: ImIpc.GatewayTest,
  getStatus: ImIpc.StatusGet,
  getLocalIp: ImIpc.GetLocalIp,
  weixinLoginStart: WeixinInstallIpc.Start,
  weixinLoginPoll: WeixinInstallIpc.Poll,
} as const;

export const imInstanceContractChannels: IpcContractChannels<typeof imInstanceContract> = {
  addDingTalkInstance: ImInstanceIpc.dingtalkAdd,
  deleteDingTalkInstance: ImInstanceIpc.dingtalkDelete,
  setDingTalkInstanceConfig: ImInstanceIpc.dingtalkSetConfig,
  addQQInstance: ImInstanceIpc.qqAdd,
  deleteQQInstance: ImInstanceIpc.qqDelete,
  setQQInstanceConfig: ImInstanceIpc.qqSetConfig,
  addFeishuInstance: ImInstanceIpc.feishuAdd,
  deleteFeishuInstance: ImInstanceIpc.feishuDelete,
  setFeishuInstanceConfig: ImInstanceIpc.feishuSetConfig,
  addWecomInstance: ImInstanceIpc.wecomAdd,
  deleteWecomInstance: ImInstanceIpc.wecomDelete,
  setWecomInstanceConfig: ImInstanceIpc.wecomSetConfig,
  addTelegramInstance: ImInstanceIpc.telegramAdd,
  deleteTelegramInstance: ImInstanceIpc.telegramDelete,
  setTelegramInstanceConfig: ImInstanceIpc.telegramSetConfig,
  addDiscordInstance: ImInstanceIpc.discordAdd,
  deleteDiscordInstance: ImInstanceIpc.discordDelete,
  setDiscordInstanceConfig: ImInstanceIpc.discordSetConfig,
} as const;

export const feishuInstallContractChannels: IpcContractChannels<typeof feishuInstallContract> = {
  verify: FeishuInstallIpc.Verify,
} as const;

export const dingtalkInstallContractChannels: IpcContractChannels<typeof dingtalkInstallContract> =
  {
    qrcode: DingTalkInstallIpc.Qrcode,
    poll: DingTalkInstallIpc.Poll,
    verify: DingTalkInstallIpc.Verify,
  } as const;
