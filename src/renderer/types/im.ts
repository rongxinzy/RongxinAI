/**
 * IM Gateway Types for Renderer Process
 * Mirrors src/main/im/types.ts for use in React components
 */

import type { Platform } from '@shared/platform';

// ==================== DingTalk Types ====================

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

interface DingTalkGatewayStatus {
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

interface DingTalkMultiInstanceStatus {
  instances: DingTalkInstanceStatus[];
}

const DEFAULT_DINGTALK_MULTI_INSTANCE_CONFIG: DingTalkMultiInstanceConfig = {
  instances: [],
};

// ==================== Feishu Types ====================

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

interface FeishuGatewayStatus {
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

interface FeishuMultiInstanceStatus {
  instances: FeishuInstanceStatus[];
}

// ==================== Telegram Types ====================

interface TelegramGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  botUsername: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

// ==================== Telegram Channel Types ====================

interface TelegramChannelGroupConfig {
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

interface TelegramMultiInstanceStatus {
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

interface DiscordGatewayStatus {
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

interface DiscordMultiInstanceStatus {
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

interface QQGatewayStatus {
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

interface QQMultiInstanceStatus {
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

interface WecomGatewayStatus {
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

interface WecomMultiInstanceStatus {
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

interface WeixinGatewayStatus {
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

export type IMGatewayConfigPatch = Omit<Partial<IMGatewayConfig>, 'weixin'> & {
  weixin?: Partial<WeixinChannelConfig>;
};

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
  | 'channel_runtime_not_running'
  | 'qq_guild_mention_hint'
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

// ==================== Pairing Types ====================

// ==================== Default Configurations ====================

const DEFAULT_DISCORD_MULTI_INSTANCE_CONFIG: DiscordMultiInstanceConfig = {
  instances: [],
};

const DEFAULT_TELEGRAM_MULTI_INSTANCE_CONFIG: TelegramMultiInstanceConfig = {
  instances: [],
};

const DEFAULT_QQ_MULTI_INSTANCE_CONFIG: QQMultiInstanceConfig = {
  instances: [],
};

const DEFAULT_FEISHU_MULTI_INSTANCE_CONFIG: FeishuMultiInstanceConfig = {
  instances: [],
};

const DEFAULT_WECOM_MULTI_INSTANCE_CONFIG: WecomMultiInstanceConfig = { instances: [] };

const DEFAULT_WEIXIN_CONFIG: WeixinChannelConfig = {
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

const DEFAULT_IM_SETTINGS: IMSettings = {
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

export const DEFAULT_IM_STATUS: IMGatewayStatus = {
  dingtalk: {
    instances: [],
  },
  feishu: {
    instances: [],
  },
  telegram: { instances: [] },
  discord: {
    instances: [],
  },
  qq: {
    instances: [],
  },
  wecom: {
    instances: [],
  },
  weixin: {
    connected: false,
    startedAt: null,
    lastError: null,
    lastInboundAt: null,
    lastOutboundAt: null,
  },
};
