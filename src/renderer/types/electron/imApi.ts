/**
 * IM (instant messaging) preload surface, split from `../electron.d.ts`.
 *
 * Contains the gateway config/status types for every channel (DingTalk,
 * Feishu, Telegram, Discord, QQ, WeCom, Weixin) and the `im` namespace
 * (config sync, gateway lifecycle, per-channel instance management, login
 * flows and status/message subscriptions).
 */
import type { Platform } from '@shared/platform';
import type { WeixinLoginErrorCode } from '../../../shared/ipc/channels';

export interface ImApi {
  getConfig: () => Promise<{ success: boolean; config?: IMGatewayConfig; error?: string }>;
  setConfig: (
    config: IMGatewayConfigPatch,
    options?: { syncGateway?: boolean },
  ) => Promise<{ success: boolean; error?: string }>;
  syncConfig: () => Promise<{ success: boolean; error?: string }>;
  startGateway: (platform: Platform) => Promise<{ success: boolean; error?: string }>;
  stopGateway: (platform: Platform) => Promise<{ success: boolean; error?: string }>;
  testGateway: (
    platform: Platform,
    configOverride?: Partial<IMGatewayConfig>,
    accountId?: string,
  ) => Promise<{ success: boolean; result?: IMConnectivityTestResult; error?: string }>;
  getStatus: () => Promise<{ success: boolean; status?: IMGatewayStatus; error?: string }>;
  getLocalIp: () => Promise<string>;
  weixinLoginStart: () => Promise<{
    success: boolean;
    status?: 'wait';
    qrcode?: string;
    qrcodeUrl?: string;
    errorCode?: WeixinLoginErrorCode;
  }>;
  weixinLoginPoll: (qrcode: string) => Promise<{
    success: boolean;
    status: 'wait' | 'scaned' | 'confirmed' | 'expired';
    accountId?: string;
    errorCode?: WeixinLoginErrorCode;
  }>;
  addQQInstance: (
    name: string,
    workspaceId: string,
  ) => Promise<{ success: boolean; instance?: QQInstanceConfig; error?: string }>;
  deleteQQInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  setQQInstanceConfig: (
    instanceId: string,
    config: any,
    options?: { syncGateway?: boolean },
  ) => Promise<{ success: boolean; error?: string }>;
  addFeishuInstance: (
    name: string,
    workspaceId: string,
  ) => Promise<{ success: boolean; instance?: FeishuInstanceConfig; error?: string }>;
  deleteFeishuInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  setFeishuInstanceConfig: (
    instanceId: string,
    config: any,
    options?: { syncGateway?: boolean },
  ) => Promise<{ success: boolean; error?: string }>;
  addDingTalkInstance: (
    name: string,
    workspaceId: string,
  ) => Promise<{ success: boolean; instance?: DingTalkInstanceConfig; error?: string }>;
  deleteDingTalkInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  setDingTalkInstanceConfig: (
    instanceId: string,
    config: any,
    options?: { syncGateway?: boolean },
  ) => Promise<{ success: boolean; error?: string }>;
  addWecomInstance: (
    name: string,
    workspaceId: string,
  ) => Promise<{ success: boolean; instance?: WecomInstanceConfig; error?: string }>;
  deleteWecomInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  setWecomInstanceConfig: (
    instanceId: string,
    config: any,
    options?: { syncGateway?: boolean },
  ) => Promise<{ success: boolean; error?: string }>;
  addTelegramInstance: (
    name: string,
    workspaceId: string,
  ) => Promise<{ success: boolean; instance?: TelegramInstanceConfig; error?: string }>;
  deleteTelegramInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  setTelegramInstanceConfig: (
    instanceId: string,
    config: any,
    options?: { syncGateway?: boolean },
  ) => Promise<{ success: boolean; error?: string }>;
  addDiscordInstance: (
    name: string,
    workspaceId: string,
  ) => Promise<{ success: boolean; instance?: DiscordInstanceConfig; error?: string }>;
  deleteDiscordInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  setDiscordInstanceConfig: (
    instanceId: string,
    config: any,
    options?: { syncGateway?: boolean },
  ) => Promise<{ success: boolean; error?: string }>;
  onStatusChange: (callback: (status: IMGatewayStatus) => void) => () => void;
  onMessageReceived: (callback: (message: IMMessage) => void) => () => void;
}

interface IMGatewayConfig {
  dingtalk: DingTalkMultiInstanceConfig;
  feishu: FeishuMultiInstanceConfig;
  telegram: TelegramMultiInstanceConfig;
  qq: QQMultiInstanceConfig;
  discord: DiscordMultiInstanceConfig;
  wecom: WecomMultiInstanceConfig;
  weixin: WeixinChannelConfig;
  settings: IMSettings;
}

type IMGatewayConfigPatch = Omit<Partial<IMGatewayConfig>, 'weixin'> & {
  weixin?: Partial<WeixinChannelConfig>;
};

interface DingTalkChannelConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  dmPolicy: 'open' | 'pairing' | 'allowlist';
  allowFrom: string[];
  groupPolicy: 'open' | 'allowlist';
  sessionTimeout: number;
  separateSessionByConversation: boolean;
  groupSessionScope: 'group' | 'group_sender';
  sharedMemoryAcrossConversations: boolean;
  gatewayBaseUrl: string;
  debug: boolean;
}

interface DingTalkInstanceConfig extends DingTalkChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface DingTalkInstanceStatus extends DingTalkGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface DingTalkMultiInstanceConfig {
  instances: DingTalkInstanceConfig[];
}

interface DingTalkMultiInstanceStatus {
  instances: DingTalkInstanceStatus[];
}

interface FeishuChannelGroupConfig {
  requireMention?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
}

interface FeishuChannelFooterConfig {
  status?: boolean;
  elapsed?: boolean;
}

interface FeishuChannelBlockStreamingCoalesceConfig {
  minChars?: number;
  maxChars?: number;
  idleMs?: number;
}

interface FeishuChannelConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  domain: 'feishu' | 'lark' | string;
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  allowFrom: string[];
  groupPolicy: 'allowlist' | 'open' | 'disabled';
  groupAllowFrom: string[];
  groups: Record<string, FeishuChannelGroupConfig>;
  historyLimit: number;
  streaming: boolean;
  replyMode: 'auto' | 'static' | 'streaming';
  blockStreaming: boolean;
  footer: FeishuChannelFooterConfig;
  blockStreamingCoalesce?: FeishuChannelBlockStreamingCoalesceConfig;
  mediaMaxMb: number;
  debug: boolean;
}

interface FeishuInstanceConfig extends FeishuChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface FeishuInstanceStatus extends FeishuGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface FeishuMultiInstanceConfig {
  instances: FeishuInstanceConfig[];
}

interface FeishuMultiInstanceStatus {
  instances: FeishuInstanceStatus[];
}

interface TelegramChannelGroupConfig {
  requireMention?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
}

interface TelegramChannelConfig {
  enabled: boolean;
  botToken: string;
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  allowFrom: string[];
  groupPolicy: 'allowlist' | 'open' | 'disabled';
  groupAllowFrom: string[];
  groups: Record<string, TelegramChannelGroupConfig>;
  historyLimit: number;
  replyToMode: 'off' | 'first' | 'all';
  linkPreview: boolean;
  streaming: 'off' | 'partial' | 'block' | 'progress';
  mediaMaxMb: number;
  proxy: string;
  webhookUrl: string;
  webhookSecret: string;
  debug: boolean;
}

interface TelegramInstanceConfig extends TelegramChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface TelegramInstanceStatus extends TelegramGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface TelegramMultiInstanceConfig {
  instances: TelegramInstanceConfig[];
}

interface TelegramMultiInstanceStatus {
  instances: TelegramInstanceStatus[];
}

interface DiscordChannelGuildConfig {
  requireMention?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
}

interface DiscordChannelConfig {
  enabled: boolean;
  botToken: string;
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  allowFrom: string[];
  groupPolicy: 'allowlist' | 'open' | 'disabled';
  groupAllowFrom: string[];
  guilds: Record<string, DiscordChannelGuildConfig>;
  historyLimit: number;
  streaming: 'off' | 'partial' | 'block' | 'progress';
  mediaMaxMb: number;
  proxy: string;
  debug: boolean;
}

interface QQConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  dmPolicy: 'open' | 'pairing' | 'allowlist';
  allowFrom: string[];
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  groupAllowFrom: string[];
  historyLimit: number;
  markdownSupport: boolean;
  imageServerBaseUrl: string;
  debug: boolean;
}

interface QQInstanceConfig extends QQConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface QQMultiInstanceConfig {
  instances: QQInstanceConfig[];
}

interface QQInstanceStatus extends QQGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface QQMultiInstanceStatus {
  instances: QQInstanceStatus[];
}

interface WecomConfig {
  enabled: boolean;
  botId: string;
  secret: string;
  dmPolicy: 'open' | 'pairing' | 'allowlist' | 'disabled';
  allowFrom: string[];
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  groupAllowFrom: string[];
  sendThinkingMessage: boolean;
  debug: boolean;
}

interface WecomInstanceConfig extends WecomConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface WecomMultiInstanceConfig {
  instances: WecomInstanceConfig[];
}

interface WecomInstanceStatus extends WecomGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface WecomMultiInstanceStatus {
  instances: WecomInstanceStatus[];
}

interface WeixinChannelConfig {
  enabled: boolean;
  accountId: string;
  workspaceId: string;
  token: string;
  baseUrl: string;
  dmPolicy: 'open' | 'pairing' | 'allowlist' | 'disabled';
  allowFrom: string[];
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  groupAllowFrom: string[];
  debug: boolean;
}

interface IMSettings {
  systemPrompt?: string;
  skillsEnabled: boolean;
}

interface IMGatewayStatus {
  dingtalk: DingTalkMultiInstanceStatus;
  feishu: FeishuMultiInstanceStatus;
  qq: QQMultiInstanceStatus;
  telegram: TelegramMultiInstanceStatus;
  discord: DiscordMultiInstanceStatus;
  wecom: WecomMultiInstanceStatus;
  weixin: WeixinGatewayStatus;
}

type IMConnectivityVerdict = 'pass' | 'warn' | 'fail';

type IMConnectivityCheckLevel = 'pass' | 'info' | 'warn' | 'fail';

type IMConnectivityCheckCode =
  | 'missing_credentials'
  | 'auth_check'
  | 'gateway_running'
  | 'inbound_activity'
  | 'outbound_activity'
  | 'platform_last_error'
  | 'feishu_group_requires_mention'
  | 'feishu_event_subscription_required'
  | 'discord_group_requires_mention'
  | 'telegram_privacy_mode_hint'
  | 'dingtalk_bot_membership_hint'
  | 'qq_guild_mention_hint';

interface IMConnectivityCheck {
  code: IMConnectivityCheckCode;
  level: IMConnectivityCheckLevel;
  message: string;
  suggestion?: string;
}

interface IMConnectivityTestResult {
  platform: Platform;
  testedAt: number;
  verdict: IMConnectivityVerdict;
  checks: IMConnectivityCheck[];
}

interface DingTalkGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface FeishuGatewayStatus {
  connected: boolean;
  startedAt: string | null;
  botOpenId: string | null;
  error: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface TelegramGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  botUsername: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface DiscordGatewayStatus {
  connected: boolean;
  starting: boolean;
  startedAt: number | null;
  lastError: string | null;
  botUsername: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface DiscordInstanceConfig extends DiscordChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface DiscordInstanceStatus extends DiscordGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface DiscordMultiInstanceConfig {
  instances: DiscordInstanceConfig[];
}

interface DiscordMultiInstanceStatus {
  instances: DiscordInstanceStatus[];
}

interface QQGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface WecomGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  botId: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface WeixinGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface IMMessage {
  platform: Platform;
  messageId: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  content: string;
  chatType: 'direct' | 'group';
  timestamp: number;
}
