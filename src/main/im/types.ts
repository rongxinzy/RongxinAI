/**
 * IM Gateway Type Definitions
 * Types for DingTalk, Feishu and Telegram IM bot integration
 */

import type { Platform } from '../../shared/platform';
export type { Platform } from '../../shared/platform';

export interface DingTalkChannelConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  dmPolicy: 'open' | 'pairing' | 'allowlist';
  allowFrom: string[];
  groupPolicy: 'open' | 'allowlist';
  /** @deprecated since dingtalk-connector v0.7.5 鈥?use Gateway session.reset.idleMinutes instead */
  sessionTimeout: number;
  separateSessionByConversation: boolean;
  groupSessionScope: 'group' | 'group_sender';
  sharedMemoryAcrossConversations: boolean;
  gatewayBaseUrl: string;
  debug: boolean;
}

export interface DingTalkGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

// ==================== DingTalk Multi-Instance Types ====================

export const MAX_DINGTALK_INSTANCES = 5;

export interface DingTalkInstanceConfig extends DingTalkChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

export interface DingTalkInstanceStatus extends DingTalkGatewayStatus {
  instanceId: string;
  instanceName: string;
}

export interface DingTalkMultiInstanceConfig {
  instances: DingTalkInstanceConfig[];
}

export interface DingTalkMultiInstanceStatus {
  instances: DingTalkInstanceStatus[];
}

export const DEFAULT_DINGTALK_MULTI_INSTANCE_CONFIG: DingTalkMultiInstanceConfig = {
  instances: [],
};

// ==================== Feishu Types ====================

export interface FeishuChannelGroupConfig {
  requireMention?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
}

export interface FeishuChannelFooterConfig {
  status?: boolean;
  elapsed?: boolean;
}

export interface FeishuChannelBlockStreamingCoalesceConfig {
  minChars?: number;
  maxChars?: number;
  idleMs?: number;
}

export interface FeishuChannelConfig {
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

export interface FeishuGatewayStatus {
  connected: boolean;
  startedAt: string | null;
  botOpenId: string | null;
  error: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

// ==================== Feishu Multi-Instance Types ====================

export const MAX_FEISHU_INSTANCES = 5;

export interface FeishuInstanceConfig extends FeishuChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

export interface FeishuInstanceStatus extends FeishuGatewayStatus {
  instanceId: string;
  instanceName: string;
}

export interface FeishuMultiInstanceConfig {
  instances: FeishuInstanceConfig[];
}

export interface FeishuMultiInstanceStatus {
  instances: FeishuInstanceStatus[];
}

// ==================== Telegram Types ====================

export interface TelegramChannelGroupConfig {
  requireMention?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
}

export interface TelegramChannelConfig {
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

export interface TelegramGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  botUsername: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

// ==================== Telegram Multi-Instance Types ====================

export const MAX_TELEGRAM_INSTANCES = 5;

export interface TelegramInstanceConfig extends TelegramChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

export interface TelegramInstanceStatus extends TelegramGatewayStatus {
  instanceId: string;
  instanceName: string;
}

export interface TelegramMultiInstanceConfig {
  instances: TelegramInstanceConfig[];
}

export interface TelegramMultiInstanceStatus {
  instances: TelegramInstanceStatus[];
}

// ==================== Discord Types ====================

export interface DiscordChannelGuildConfig {
  requireMention?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
}

export interface DiscordChannelConfig {
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

export interface DiscordGatewayStatus {
  connected: boolean;
  starting: boolean;
  startedAt: number | null;
  lastError: string | null;
  botUsername: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

export const MAX_DISCORD_INSTANCES = 5;

export interface DiscordInstanceConfig extends DiscordChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

export interface DiscordInstanceStatus extends DiscordGatewayStatus {
  instanceId: string;
  instanceName: string;
}

export interface DiscordMultiInstanceConfig {
  instances: DiscordInstanceConfig[];
}

export interface DiscordMultiInstanceStatus {
  instances: DiscordInstanceStatus[];
}

// ==================== QQ Types ====================

export interface QQChannelConfig {
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

/** @deprecated Use QQChannelConfig instead */
export type QQConfig = QQChannelConfig;

export interface QQGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

// ==================== QQ Multi-Instance Types ====================

export const MAX_QQ_INSTANCES = 5;

export interface QQInstanceConfig extends QQChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

export interface QQInstanceStatus extends QQGatewayStatus {
  instanceId: string;
  instanceName: string;
}

export interface QQMultiInstanceConfig {
  instances: QQInstanceConfig[];
}

export interface QQMultiInstanceStatus {
  instances: QQInstanceStatus[];
}

// ==================== WeCom (浼佷笟寰俊) Types ====================

export interface WecomChannelConfig {
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

/** @deprecated Use WecomChannelConfig instead */
export type WecomConfig = WecomChannelConfig;

export interface WecomGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  botId: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

// ==================== WeCom Multi-Instance Types ====================

export const MAX_WECOM_INSTANCES = 5;

export interface WecomInstanceConfig extends WecomChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

export interface WecomInstanceStatus extends WecomGatewayStatus {
  instanceId: string;
  instanceName: string;
}

export interface WecomMultiInstanceConfig {
  instances: WecomInstanceConfig[];
}

export interface WecomMultiInstanceStatus {
  instances: WecomInstanceStatus[];
}

// ==================== Weixin (寰俊) Types ====================

export interface WeixinChannelConfig {
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

export interface WeixinGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

// ==================== Common IM Types ====================

export interface IMGatewayConfig {
  dingtalk: DingTalkMultiInstanceConfig;
  feishu: FeishuMultiInstanceConfig;
  telegram: TelegramMultiInstanceConfig;
  qq: QQMultiInstanceConfig;
  discord: DiscordMultiInstanceConfig;
  wecom: WecomMultiInstanceConfig;
  weixin: WeixinChannelConfig;
  settings: IMSettings;
}

export interface IMSettings {
  systemPrompt?: string;
  skillsEnabled: boolean;
}

export interface IMGatewayStatus {
  dingtalk: DingTalkMultiInstanceStatus;
  feishu: FeishuMultiInstanceStatus;
  qq: QQMultiInstanceStatus;
  telegram: TelegramMultiInstanceStatus;
  discord: DiscordMultiInstanceStatus;
  wecom: WecomMultiInstanceStatus;
  weixin: WeixinGatewayStatus;
}

// ==================== Media Attachment Types ====================

export type IMMediaType = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';

export interface IMMediaAttachment {
  type: IMMediaType;
  localPath: string; // 涓嬭浇鍚庣殑鏈湴璺緞
  mimeType: string; // MIME 绫诲瀷
  fileName?: string; // 鍘熷鏂囦欢鍚?
  fileSize?: number; // 鏂囦欢澶у皬锛堝瓧鑺傦級
  width?: number; // 鍥剧墖/瑙嗛瀹藉害
  height?: number; // 鍥剧墖/瑙嗛楂樺害
  duration?: number; // 闊宠棰戞椂闀匡紙绉掞級
}

export interface IMMessage {
  platform: Platform;
  messageId: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  groupName?: string; // 缇ゅ悕/棰戦亾鍚嶏紙鐢ㄤ簬浼氳瘽鏍囬锛?
  content: string;
  chatType: 'direct' | 'group';
  /** 瀛愮被鍨嬶紝鐢ㄤ簬鍖哄垎鍚屽钩鍙颁笉鍚屼細璇濇潵婧愶紝濡?'qchat' */
  chatSubType?: string;
  timestamp: number;
  attachments?: IMMediaAttachment[];
  mediaGroupId?: string; // 濯掍綋缁?ID锛堢敤浜庡悎骞跺寮犲浘鐗囷級
}

export interface IMReplyContext {
  platform: Platform;
  conversationId: string;
  messageId?: string;
  // DingTalk specific
  sessionWebhook?: string;
  // Feishu specific
  chatId?: string;
}

// ==================== IM Session Mapping ====================

export interface IMSessionMapping {
  imConversationId: string;
  platform: Platform;
  coworkSessionId: string;
  transportSessionKey?: string;
  createdAt: number;
  lastActiveAt: number;
}

// ==================== IPC Result Types ====================

export interface IMConfigResult {
  success: boolean;
  config?: IMGatewayConfig;
  error?: string;
}

export interface IMStatusResult {
  success: boolean;
  status?: IMGatewayStatus;
  error?: string;
}

export interface IMGatewayResult {
  success: boolean;
  error?: string;
}

// ==================== Connectivity Test Types ====================

export type IMConnectivityVerdict = 'pass' | 'warn' | 'fail';

export type IMConnectivityCheckLevel = 'pass' | 'info' | 'warn' | 'fail';

export type IMConnectivityCheckCode =
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
  | 'channel_runtime_not_running'
  | 'qq_guild_mention_hint'
  | 'qq_mention_hint'
  | 'weixin_not_logged_in'
  | 'weixin_account_missing'
  | 'weixin_gateway_probe_failed';

export interface IMConnectivityCheck {
  code: IMConnectivityCheckCode;
  level: IMConnectivityCheckLevel;
  message: string;
  suggestion?: string;
}

export interface IMConnectivityTestResult {
  platform: Platform;
  testedAt: number;
  verdict: IMConnectivityVerdict;
  checks: IMConnectivityCheck[];
}

export interface IMConnectivityTestResponse {
  success: boolean;
  result?: IMConnectivityTestResult;
  error?: string;
}

// ==================== Default Configurations ====================

export const DEFAULT_DINGTALK_CHANNEL_CONFIG: DingTalkChannelConfig = {
  enabled: false,
  clientId: '',
  clientSecret: '',
  dmPolicy: 'open',
  allowFrom: [],
  groupPolicy: 'open',
  sessionTimeout: 1800000,
  separateSessionByConversation: true,
  groupSessionScope: 'group',
  sharedMemoryAcrossConversations: false,
  gatewayBaseUrl: '',
  debug: false,
};

export const DEFAULT_FEISHU_CHANNEL_CONFIG: FeishuChannelConfig = {
  enabled: false,
  appId: '',
  appSecret: '',
  domain: 'feishu',
  dmPolicy: 'open',
  allowFrom: [],
  groupPolicy: 'open',
  groupAllowFrom: [],
  groups: { '*': { requireMention: true } },
  historyLimit: 50,
  streaming: true,
  replyMode: 'auto',
  blockStreaming: false,
  footer: { status: true, elapsed: true },
  mediaMaxMb: 30,
  debug: false,
};

export const DEFAULT_DISCORD_CHANNEL_CONFIG: DiscordChannelConfig = {
  enabled: false,
  botToken: '',
  dmPolicy: 'open',
  allowFrom: [],
  groupPolicy: 'allowlist',
  groupAllowFrom: [],
  guilds: { '*': { requireMention: true } },
  historyLimit: 50,
  streaming: 'off',
  mediaMaxMb: 25,
  proxy: '',
  debug: false,
};

export const DEFAULT_DISCORD_MULTI_INSTANCE_CONFIG: DiscordMultiInstanceConfig = {
  instances: [],
};

export const DEFAULT_TELEGRAM_CHANNEL_CONFIG: TelegramChannelConfig = {
  enabled: false,
  botToken: '',
  dmPolicy: 'open',
  allowFrom: [],
  groupPolicy: 'allowlist',
  groupAllowFrom: [],
  groups: { '*': { requireMention: true } },
  historyLimit: 50,
  replyToMode: 'off',
  linkPreview: true,
  streaming: 'off',
  mediaMaxMb: 5,
  proxy: '',
  webhookUrl: '',
  webhookSecret: '',
  debug: false,
};

export const DEFAULT_TELEGRAM_MULTI_INSTANCE_CONFIG: TelegramMultiInstanceConfig = {
  instances: [],
};

export const DEFAULT_QQ_CONFIG: QQChannelConfig = {
  enabled: false,
  appId: '',
  appSecret: '',
  dmPolicy: 'open',
  allowFrom: [],
  groupPolicy: 'open',
  groupAllowFrom: [],
  historyLimit: 50,
  markdownSupport: true,
  imageServerBaseUrl: '',
  debug: false,
};

export const DEFAULT_QQ_MULTI_INSTANCE_CONFIG: QQMultiInstanceConfig = {
  instances: [],
};

export const DEFAULT_FEISHU_MULTI_INSTANCE_CONFIG: FeishuMultiInstanceConfig = {
  instances: [],
};

export const DEFAULT_WECOM_CONFIG: WecomChannelConfig = {
  enabled: false,
  botId: '',
  secret: '',
  dmPolicy: 'open',
  allowFrom: [],
  groupPolicy: 'open',
  groupAllowFrom: [],
  sendThinkingMessage: true,
  debug: true,
};

export const DEFAULT_WECOM_MULTI_INSTANCE_CONFIG: WecomMultiInstanceConfig = { instances: [] };

export const DEFAULT_WEIXIN_CONFIG: WeixinChannelConfig = {
  enabled: false,
  accountId: '',
  workspaceId: '',
  token: '',
  baseUrl: 'https://ilinkai.weixin.qq.com',
  dmPolicy: 'open',
  allowFrom: [],
  groupPolicy: 'open',
  groupAllowFrom: [],
  debug: true,
};

export const DEFAULT_IM_SETTINGS: IMSettings = {
  systemPrompt: '',
  skillsEnabled: true,
};

export const DEFAULT_IM_CONFIG: IMGatewayConfig = {
  dingtalk: DEFAULT_DINGTALK_MULTI_INSTANCE_CONFIG,
  feishu: DEFAULT_FEISHU_MULTI_INSTANCE_CONFIG,
  telegram: DEFAULT_TELEGRAM_MULTI_INSTANCE_CONFIG,
  qq: DEFAULT_QQ_MULTI_INSTANCE_CONFIG,
  discord: DEFAULT_DISCORD_MULTI_INSTANCE_CONFIG,
  wecom: DEFAULT_WECOM_MULTI_INSTANCE_CONFIG,
  weixin: DEFAULT_WEIXIN_CONFIG,
  settings: DEFAULT_IM_SETTINGS,
};

export const DEFAULT_DINGTALK_STATUS: DingTalkGatewayStatus = {
  connected: false,
  startedAt: null,
  lastError: null,
  lastInboundAt: null,
  lastOutboundAt: null,
};

export const DEFAULT_FEISHU_STATUS: FeishuGatewayStatus = {
  connected: false,
  startedAt: null,
  botOpenId: null,
  error: null,
  lastInboundAt: null,
  lastOutboundAt: null,
};

export const DEFAULT_DISCORD_STATUS: DiscordGatewayStatus = {
  connected: false,
  starting: false,
  startedAt: null,
  lastError: null,
  botUsername: null,
  lastInboundAt: null,
  lastOutboundAt: null,
};

export const DEFAULT_QQ_STATUS: QQGatewayStatus = {
  connected: false,
  startedAt: null,
  lastError: null,
  lastInboundAt: null,
  lastOutboundAt: null,
};

export const DEFAULT_WECOM_STATUS: WecomGatewayStatus = {
  connected: false,
  startedAt: null,
  lastError: null,
  botId: null,
  lastInboundAt: null,
  lastOutboundAt: null,
};

export const DEFAULT_WEIXIN_STATUS: WeixinGatewayStatus = {
  connected: false,
  startedAt: null,
  lastError: null,
  lastInboundAt: null,
  lastOutboundAt: null,
};

export const DEFAULT_IM_STATUS: IMGatewayStatus = {
  dingtalk: { instances: [] },
  feishu: { instances: [] },
  telegram: { instances: [] },
  qq: { instances: [] },
  discord: { instances: [] },
  wecom: { instances: [] },
  weixin: DEFAULT_WEIXIN_STATUS,
};

// ==================== Media Marker Types ====================

export interface MediaMarker {
  type: 'image' | 'video' | 'audio' | 'file';
  path: string;
  name?: string;
  originalMarker: string;
}
