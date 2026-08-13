/**
 * IM Gateway Store
 * SQLite operations for IM configuration storage
 */

import Database from 'better-sqlite3';

import { tryParseCcConnectScopedConversationId } from './ccConnectConversationId';
import type { IMGatewayConfigPatch } from './configPatch';

import {
  DEFAULT_DINGTALK_MULTI_INSTANCE_CONFIG,
  DEFAULT_DINGTALK_CHANNEL_CONFIG,
  DEFAULT_DISCORD_MULTI_INSTANCE_CONFIG,
  DEFAULT_DISCORD_CHANNEL_CONFIG,
  DEFAULT_FEISHU_MULTI_INSTANCE_CONFIG,
  DEFAULT_FEISHU_CHANNEL_CONFIG,
  DEFAULT_IM_SETTINGS,
  DEFAULT_QQ_CONFIG,
  DEFAULT_QQ_MULTI_INSTANCE_CONFIG,
  DEFAULT_TELEGRAM_MULTI_INSTANCE_CONFIG,
  DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  DEFAULT_WECOM_CONFIG,
  DEFAULT_WECOM_MULTI_INSTANCE_CONFIG,
  DEFAULT_WEIXIN_CONFIG,
  DingTalkInstanceConfig,
  DingTalkMultiInstanceConfig,
  DiscordInstanceConfig,
  DiscordMultiInstanceConfig,
  FeishuInstanceConfig,
  FeishuMultiInstanceConfig,
  IMGatewayConfig,
  IMSessionMapping,
  IMSettings,
  Platform,
  QQConfig,
  QQInstanceConfig,
  QQMultiInstanceConfig,
  TelegramInstanceConfig,
  TelegramMultiInstanceConfig,
  WecomInstanceConfig,
  WecomMultiInstanceConfig,
  WeixinChannelConfig,
} from './types';

interface StoredConversationReplyRoute {
  channel: string;
  to: string;
  accountId?: string;
}

interface StoredCcConnectSessionRoute {
  sessionKey: string;
}

interface SessionMappingRow {
  im_conversation_id: string;
  platform: string;
  cowork_session_id: string;
  transport_session_key?: string | null;
  created_at: number;
  last_active_at: number;
}

export class IMStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initializeTables();
  }

  private initializeTables() {
    this.db
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS im_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
      )
      .run();

    // IM session mappings table for Cowork mode
    this.db
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS channel_session_mappings (
        im_conversation_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        cowork_session_id TEXT NOT NULL,
        transport_session_key TEXT,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        PRIMARY KEY (im_conversation_id, platform)
      );
    `,
      )
      .run();
  }
  private getConfigValue<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM im_config WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) return undefined;
    const value = row.value;
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.warn(`Failed to parse im_config value for ${key}`, error);
      return undefined;
    }
  }

  private setConfigValue<T>(key: string, value: T): void {
    const now = Date.now();
    this.db
      .prepare(
        `
      INSERT INTO im_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
      )
      .run(key, JSON.stringify(value), now);
  }

  // ==================== Full Config Operations ====================

  getConfig(): IMGatewayConfig {
    const dingtalkMulti = this.getDingTalkMultiInstanceConfig();
    const telegramMulti = this.getTelegramMultiInstanceConfig();
    const discordMulti = this.getDiscordMultiInstanceConfig();
    const qqMulti = this.getQQMultiInstanceConfig();
    const feishuMulti = this.getFeishuMultiInstanceConfig();
    const wecomMulti = this.getWecomMultiInstanceConfig();
    const weixin = this.getConfigValue<WeixinChannelConfig>('weixin') ?? DEFAULT_WEIXIN_CONFIG;
    const settings = this.normalizeIMSettings(this.getConfigValue<IMSettings>('settings'));

    // Resolve enabled field: default to false for safety
    // User must explicitly enable the service by setting enabled: true
    const resolveEnabled = <T extends { enabled?: boolean }>(stored: T, defaults: T): T => {
      const merged = { ...defaults, ...stored };
      // If enabled is not explicitly set, default to false (safer behavior)
      if (stored.enabled === undefined) {
        return { ...merged, enabled: false };
      }
      return merged;
    };

    return {
      dingtalk: dingtalkMulti,
      feishu: feishuMulti,
      telegram: telegramMulti,
      discord: discordMulti,
      qq: qqMulti,
      wecom: wecomMulti,
      weixin: resolveEnabled(weixin, DEFAULT_WEIXIN_CONFIG),
      settings,
    };
  }

  setConfig(config: IMGatewayConfigPatch): void {
    if (config.dingtalk) {
      this.setDingTalkMultiInstanceConfig(config.dingtalk);
    }
    if (config.feishu) {
      this.setFeishuMultiInstanceConfig(config.feishu);
    }
    if (config.telegram) {
      this.setTelegramMultiInstanceConfig(config.telegram);
    }
    if (config.discord) {
      this.setDiscordMultiInstanceConfig(config.discord);
    }
    if (config.qq) {
      this.setQQMultiInstanceConfig(config.qq);
    }
    if (config.wecom) {
      this.setWecomMultiInstanceConfig(config.wecom);
    }
    if (config.weixin) {
      this.setWeixinConfig(config.weixin);
    }
    if (config.settings) {
      this.setIMSettings(config.settings);
    }
  }

  // ==================== DingTalk Multi-Instance Config ====================

  getDingTalkInstances(): DingTalkInstanceConfig[] {
    const rows = this.db
      .prepare('SELECT key, value FROM im_config WHERE key LIKE ?')
      .all('dingtalk:%') as Array<{ key: string; value: string }>;
    if (!rows.length) return [];
    const instances: DingTalkInstanceConfig[] = [];
    for (const row of rows) {
      try {
        const config = JSON.parse(row.value) as DingTalkInstanceConfig;
        instances.push({ ...DEFAULT_DINGTALK_CHANNEL_CONFIG, ...config });
      } catch {
        // Ignore parse errors
      }
    }
    return instances;
  }

  getDingTalkInstanceConfig(instanceId: string): DingTalkInstanceConfig | null {
    const stored = this.getConfigValue<DingTalkInstanceConfig>(`dingtalk:${instanceId}`);
    if (!stored) return null;
    return { ...DEFAULT_DINGTALK_CHANNEL_CONFIG, ...stored };
  }

  setDingTalkInstanceConfig(instanceId: string, config: Partial<DingTalkInstanceConfig>): void {
    const current = this.getDingTalkInstanceConfig(instanceId);
    if (current) {
      this.setConfigValue(`dingtalk:${instanceId}`, { ...current, ...config });
    } else {
      this.setConfigValue(`dingtalk:${instanceId}`, {
        ...DEFAULT_DINGTALK_CHANNEL_CONFIG,
        instanceId,
        instanceName: config.instanceName || 'DingTalk Bot',
        ...config,
      });
    }
  }

  deleteDingTalkInstance(instanceId: string): void {
    const now = Date.now();
    this.db.prepare('DELETE FROM im_config WHERE key = ?').run(`dingtalk:${instanceId}`);
    // Clean up session mappings for this instance
    this.db
      .prepare('DELETE FROM channel_session_mappings WHERE platform = ?')
      .run(`dingtalk:${instanceId}`);
    void now;
  }

  getDingTalkMultiInstanceConfig(): DingTalkMultiInstanceConfig {
    const instances = this.getDingTalkInstances();
    if (instances.length === 0) return DEFAULT_DINGTALK_MULTI_INSTANCE_CONFIG;
    return { instances };
  }

  setDingTalkMultiInstanceConfig(config: DingTalkMultiInstanceConfig): void {
    // Write each instance individually
    for (const inst of config.instances) {
      this.setDingTalkInstanceConfig(inst.instanceId, inst);
    }
  }

  // ==================== Feishu Multi-Instance Config ====================

  getFeishuInstances(): FeishuInstanceConfig[] {
    const rows = this.db
      .prepare('SELECT key, value FROM im_config WHERE key LIKE ?')
      .all('feishu:%') as Array<{ key: string; value: string }>;
    if (!rows.length) return [];
    const instances: FeishuInstanceConfig[] = [];
    for (const row of rows) {
      try {
        const config = JSON.parse(row.value) as FeishuInstanceConfig;
        instances.push({ ...DEFAULT_FEISHU_CHANNEL_CONFIG, ...config });
      } catch {
        // Ignore parse errors
      }
    }
    return instances;
  }

  getFeishuInstanceConfig(instanceId: string): FeishuInstanceConfig | null {
    const stored = this.getConfigValue<FeishuInstanceConfig>(`feishu:${instanceId}`);
    if (!stored) return null;
    return { ...DEFAULT_FEISHU_CHANNEL_CONFIG, ...stored };
  }

  setFeishuInstanceConfig(instanceId: string, config: Partial<FeishuInstanceConfig>): void {
    const current = this.getFeishuInstanceConfig(instanceId);
    if (current) {
      this.setConfigValue(`feishu:${instanceId}`, { ...current, ...config });
    } else {
      this.setConfigValue(`feishu:${instanceId}`, {
        ...DEFAULT_FEISHU_CHANNEL_CONFIG,
        instanceId,
        instanceName: config.instanceName || 'Feishu Bot',
        ...config,
      });
    }
  }

  deleteFeishuInstance(instanceId: string): void {
    const now = Date.now();
    this.db.prepare('DELETE FROM im_config WHERE key = ?').run(`feishu:${instanceId}`);
    // Clean up session mappings for this instance
    this.db
      .prepare('DELETE FROM channel_session_mappings WHERE platform = ?')
      .run(`feishu:${instanceId}`);
    void now;
  }

  getFeishuMultiInstanceConfig(): FeishuMultiInstanceConfig {
    const instances = this.getFeishuInstances();
    if (instances.length === 0) return DEFAULT_FEISHU_MULTI_INSTANCE_CONFIG;
    return { instances };
  }

  setFeishuMultiInstanceConfig(config: FeishuMultiInstanceConfig): void {
    // Write each instance individually
    for (const inst of config.instances) {
      this.setFeishuInstanceConfig(inst.instanceId, inst);
    }
  }

  // ==================== Discord Multi-Instance Config ====================

  getDiscordInstances(): DiscordInstanceConfig[] {
    const rows = this.db
      .prepare('SELECT key, value FROM im_config WHERE key LIKE ?')
      .all('discord:%') as Array<{ key: string; value: string }>;
    if (!rows.length) return [];
    const instances: DiscordInstanceConfig[] = [];
    for (const row of rows) {
      try {
        const config = JSON.parse(row.value) as DiscordInstanceConfig;
        instances.push({ ...DEFAULT_DISCORD_CHANNEL_CONFIG, ...config });
      } catch {
        // Ignore parse errors
      }
    }
    return instances;
  }

  getDiscordInstanceConfig(instanceId: string): DiscordInstanceConfig | null {
    const stored = this.getConfigValue<DiscordInstanceConfig>(`discord:${instanceId}`);
    if (!stored) return null;
    return { ...DEFAULT_DISCORD_CHANNEL_CONFIG, ...stored };
  }

  setDiscordInstanceConfig(instanceId: string, config: Partial<DiscordInstanceConfig>): void {
    const current = this.getDiscordInstanceConfig(instanceId);
    if (current) {
      this.setConfigValue(`discord:${instanceId}`, { ...current, ...config });
    } else {
      this.setConfigValue(`discord:${instanceId}`, {
        ...DEFAULT_DISCORD_CHANNEL_CONFIG,
        instanceId,
        instanceName: config.instanceName || 'Discord Bot',
        ...config,
      });
    }
  }

  deleteDiscordInstance(instanceId: string): void {
    this.db.prepare('DELETE FROM im_config WHERE key = ?').run(`discord:${instanceId}`);
    this.db
      .prepare('DELETE FROM channel_session_mappings WHERE platform = ?')
      .run(`discord:${instanceId}`);
  }

  getDiscordMultiInstanceConfig(): DiscordMultiInstanceConfig {
    const instances = this.getDiscordInstances();
    if (instances.length === 0) return DEFAULT_DISCORD_MULTI_INSTANCE_CONFIG;
    return { instances };
  }

  setDiscordMultiInstanceConfig(config: DiscordMultiInstanceConfig): void {
    for (const inst of config.instances) {
      this.setDiscordInstanceConfig(inst.instanceId, inst);
    }
  }

  // ==================== Telegram Multi-Instance Config ====================

  getTelegramInstances(): TelegramInstanceConfig[] {
    const rows = this.db
      .prepare('SELECT key, value FROM im_config WHERE key LIKE ?')
      .all('telegram:%') as Array<{ key: string; value: string }>;
    if (!rows.length) return [];
    const instances: TelegramInstanceConfig[] = [];
    for (const row of rows) {
      try {
        const config = JSON.parse(row.value) as TelegramInstanceConfig;
        instances.push({ ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, ...config });
      } catch {
        // Ignore parse errors
      }
    }
    return instances;
  }

  getTelegramInstanceConfig(instanceId: string): TelegramInstanceConfig | null {
    const stored = this.getConfigValue<TelegramInstanceConfig>(`telegram:${instanceId}`);
    if (!stored) return null;
    return { ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, ...stored };
  }

  setTelegramInstanceConfig(instanceId: string, config: Partial<TelegramInstanceConfig>): void {
    const current = this.getTelegramInstanceConfig(instanceId);
    if (current) {
      this.setConfigValue(`telegram:${instanceId}`, { ...current, ...config });
    } else {
      this.setConfigValue(`telegram:${instanceId}`, {
        ...DEFAULT_TELEGRAM_CHANNEL_CONFIG,
        instanceId,
        instanceName: config.instanceName || 'Telegram Bot',
        ...config,
      });
    }
  }

  deleteTelegramInstance(instanceId: string): void {
    this.db.prepare('DELETE FROM im_config WHERE key = ?').run(`telegram:${instanceId}`);
    this.db
      .prepare('DELETE FROM channel_session_mappings WHERE platform = ?')
      .run(`telegram:${instanceId}`);
  }

  getTelegramMultiInstanceConfig(): TelegramMultiInstanceConfig {
    const instances = this.getTelegramInstances();
    if (instances.length === 0) return DEFAULT_TELEGRAM_MULTI_INSTANCE_CONFIG;
    return { instances };
  }

  setTelegramMultiInstanceConfig(config: TelegramMultiInstanceConfig): void {
    for (const inst of config.instances) {
      this.setTelegramInstanceConfig(inst.instanceId, inst);
    }
  }

  // ==================== QQ Multi-Instance Config ====================

  /** @deprecated Use getQQMultiInstanceConfig() or getQQInstances() instead */
  getQQConfig(): QQConfig {
    const stored = this.getConfigValue<QQConfig>('qq');
    return { ...DEFAULT_QQ_CONFIG, ...stored };
  }

  /** @deprecated Use setQQInstanceConfig() instead */
  setQQConfig(config: Partial<QQConfig>): void {
    const current = this.getQQConfig();
    this.setConfigValue('qq', { ...current, ...config });
  }

  getQQInstances(): QQInstanceConfig[] {
    const rows = this.db
      .prepare('SELECT key, value FROM im_config WHERE key LIKE ?')
      .all('qq:%') as Array<{ key: string; value: string }>;
    if (!rows.length) return [];
    const instances: QQInstanceConfig[] = [];
    for (const row of rows) {
      try {
        const config = JSON.parse(row.value) as QQInstanceConfig;
        instances.push({ ...DEFAULT_QQ_CONFIG, ...config });
      } catch {
        // Ignore parse errors
      }
    }
    return instances;
  }

  getQQInstanceConfig(instanceId: string): QQInstanceConfig | null {
    const stored = this.getConfigValue<QQInstanceConfig>(`qq:${instanceId}`);
    if (!stored) return null;
    return { ...DEFAULT_QQ_CONFIG, ...stored };
  }

  setQQInstanceConfig(instanceId: string, config: Partial<QQInstanceConfig>): void {
    const current = this.getQQInstanceConfig(instanceId);
    if (current) {
      this.setConfigValue(`qq:${instanceId}`, { ...current, ...config });
    } else {
      this.setConfigValue(`qq:${instanceId}`, {
        ...DEFAULT_QQ_CONFIG,
        instanceId,
        instanceName: config.instanceName || `QQ Bot`,
        ...config,
      });
    }
  }

  deleteQQInstance(instanceId: string): void {
    const now = Date.now();
    this.db.prepare('DELETE FROM im_config WHERE key = ?').run(`qq:${instanceId}`);
    // Clean up session mappings for this instance
    this.db
      .prepare('DELETE FROM channel_session_mappings WHERE platform = ?')
      .run(`qq:${instanceId}`);
    void now;
  }

  getQQMultiInstanceConfig(): QQMultiInstanceConfig {
    const instances = this.getQQInstances();
    if (instances.length === 0) return DEFAULT_QQ_MULTI_INSTANCE_CONFIG;
    return { instances };
  }

  setQQMultiInstanceConfig(config: QQMultiInstanceConfig): void {
    // Write each instance individually
    for (const inst of config.instances) {
      this.setQQInstanceConfig(inst.instanceId, inst);
    }
  }

  // ==================== WeCom Multi-Instance Config ====================

  /** @deprecated Use getWecomMultiInstanceConfig() or getWecomInstances() instead */
  getWecomInstances(): WecomInstanceConfig[] {
    const rows = this.db
      .prepare('SELECT key, value FROM im_config WHERE key LIKE ?')
      .all('wecom:%') as Array<{ key: string; value: string }>;
    if (!rows.length) return [];
    const instances: WecomInstanceConfig[] = [];
    for (const row of rows) {
      try {
        const config = JSON.parse(row.value) as WecomInstanceConfig;
        instances.push({ ...DEFAULT_WECOM_CONFIG, ...config });
      } catch {
        // Ignore parse errors
      }
    }
    return instances;
  }

  getWecomInstanceConfig(instanceId: string): WecomInstanceConfig | null {
    const stored = this.getConfigValue<WecomInstanceConfig>(`wecom:${instanceId}`);
    if (!stored) return null;
    return { ...DEFAULT_WECOM_CONFIG, ...stored };
  }

  setWecomInstanceConfig(instanceId: string, config: Partial<WecomInstanceConfig>): void {
    const current = this.getWecomInstanceConfig(instanceId);
    if (current) {
      this.setConfigValue(`wecom:${instanceId}`, { ...current, ...config });
    } else {
      this.setConfigValue(`wecom:${instanceId}`, {
        ...DEFAULT_WECOM_CONFIG,
        instanceId,
        instanceName: config.instanceName || `WeCom Bot`,
        ...config,
      });
    }
  }

  deleteWecomInstance(instanceId: string): void {
    this.db.prepare('DELETE FROM im_config WHERE key = ?').run(`wecom:${instanceId}`);
    // Clean up session mappings for this instance
    this.db
      .prepare('DELETE FROM channel_session_mappings WHERE platform = ?')
      .run(`wecom:${instanceId}`);
  }

  getWecomMultiInstanceConfig(): WecomMultiInstanceConfig {
    const instances = this.getWecomInstances();
    if (instances.length === 0) return DEFAULT_WECOM_MULTI_INSTANCE_CONFIG;
    return { instances };
  }

  setWecomMultiInstanceConfig(config: WecomMultiInstanceConfig): void {
    // Write each instance individually
    for (const inst of config.instances) {
      this.setWecomInstanceConfig(inst.instanceId, inst);
    }
  }

  // ==================== Weixin (微信) ====================

  getWeixinConfig(): WeixinChannelConfig {
    const stored = this.getConfigValue<WeixinChannelConfig>('weixin');
    return { ...DEFAULT_WEIXIN_CONFIG, ...stored };
  }

  /** Resolve the desktop-owned Workspace binding for a stable ChannelAccount id. */
  getChannelAccountWorkspaceId(accountId: string): string | null {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) return null;

    const instance = [
      ...this.getDingTalkInstances(),
      ...this.getFeishuInstances(),
      ...this.getTelegramInstances(),
      ...this.getDiscordInstances(),
      ...this.getQQInstances(),
      ...this.getWecomInstances(),
    ].find(item => item.instanceId === normalizedAccountId);
    if (instance) return instance.workspaceId.trim() || null;

    const weixin = this.getWeixinConfig();
    return weixin.accountId === normalizedAccountId ? weixin.workspaceId.trim() || null : null;
  }

  setWeixinConfig(config: Partial<WeixinChannelConfig>): void {
    const current = this.getWeixinConfig();
    this.setConfigValue('weixin', { ...current, ...config });
  }

  // ==================== IM Settings ====================

  getIMSettings(): IMSettings {
    return this.normalizeIMSettings(this.getConfigValue<IMSettings>('settings'));
  }

  setIMSettings(settings: Partial<IMSettings>): void {
    const current = this.getIMSettings();
    this.setConfigValue('settings', this.normalizeIMSettings({ ...current, ...settings }));
  }

  private normalizeIMSettings(settings?: Partial<IMSettings>): IMSettings {
    return {
      systemPrompt: settings?.systemPrompt ?? DEFAULT_IM_SETTINGS.systemPrompt,
      skillsEnabled: settings?.skillsEnabled ?? DEFAULT_IM_SETTINGS.skillsEnabled,
    };
  }

  // ==================== Utility ====================

  /**
   * Clear all IM configuration
   */
  clearConfig(): void {
    this.db.prepare('DELETE FROM im_config').run();
  }

  /**
   * Check if IM is configured (at least one platform has credentials)
   */
  isConfigured(): boolean {
    const config = this.getConfig();
    const hasDingTalk =
      config.dingtalk?.instances?.some(i => !!(i.clientId && i.clientSecret)) ?? false;
    const hasFeishu = config.feishu?.instances?.some(i => !!(i.appId && i.appSecret)) ?? false;
    const hasTelegram = config.telegram?.instances?.some(i => !!i.botToken) ?? false;
    const hasDiscord = config.discord?.instances?.some(i => !!i.botToken) ?? false;
    const hasQQ = config.qq?.instances?.some(i => !!(i.appId && i.appSecret)) ?? false;
    const hasWecom = config.wecom?.instances?.some(i => !!(i.botId && i.secret)) ?? false;
    return hasDingTalk || hasFeishu || hasTelegram || hasDiscord || hasQQ || hasWecom;
  }

  // ==================== Notification Target Persistence ====================

  /**
   * Get persisted notification target for a platform
   */
  getNotificationTarget(platform: Platform): any | null {
    return this.getConfigValue<any>(`notification_target:${platform}`) ?? null;
  }

  /**
   * Persist notification target for a platform
   */
  setNotificationTarget(platform: Platform, target: any): void {
    this.setConfigValue(`notification_target:${platform}`, target);
  }

  getConversationReplyRoute(
    platform: Platform,
    conversationId: string,
  ): StoredConversationReplyRoute | null {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      return null;
    }
    return (
      this.getConfigValue<StoredConversationReplyRoute>(
        `conversation_reply_route:${platform}:${normalizedConversationId}`,
      ) ?? null
    );
  }

  setConversationReplyRoute(
    platform: Platform,
    conversationId: string,
    route: StoredConversationReplyRoute,
  ): void {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      return;
    }
    this.setConfigValue(`conversation_reply_route:${platform}:${normalizedConversationId}`, route);
  }

  /** Keeps the sidecar-native reply key separate from legacy gateway mappings. */
  getCcConnectSessionKey(
    accountId: string,
    platform: string,
    conversationId: string,
  ): string | null {
    const route = this.getConfigValue<StoredCcConnectSessionRoute>(
      ccConnectSessionRouteKey(accountId, platform, conversationId),
    );
    return route?.sessionKey?.trim() || null;
  }

  setCcConnectSessionKey(
    accountId: string,
    platform: string,
    conversationId: string,
    sessionKey: string,
  ): void {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) return;
    this.setConfigValue(ccConnectSessionRouteKey(accountId, platform, conversationId), {
      sessionKey: normalizedSessionKey,
    });
  }

  // ==================== Session Mapping Operations ====================

  /**
   * Get session mapping by IM conversation ID and platform
   */
  getSessionMapping(imConversationId: string, platform: Platform): IMSessionMapping | null {
    const row = this.db
      .prepare(
        'SELECT im_conversation_id, platform, cowork_session_id, transport_session_key, created_at, last_active_at FROM channel_session_mappings WHERE im_conversation_id = ? AND platform = ?',
      )
      .get(imConversationId, platform) as SessionMappingRow | undefined;
    if (!row) return null;
    return {
      imConversationId: row.im_conversation_id,
      platform: row.platform as Platform,
      coworkSessionId: row.cowork_session_id,
      ...(row.transport_session_key ? { transportSessionKey: row.transport_session_key } : {}),
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    };
  }

  /**
   * Find the IM mapping that owns a given cowork session ID.
   */
  getSessionMappingByCoworkSessionId(coworkSessionId: string): IMSessionMapping | null {
    const row = this.db
      .prepare(
        'SELECT im_conversation_id, platform, cowork_session_id, transport_session_key, created_at, last_active_at FROM channel_session_mappings WHERE cowork_session_id = ? LIMIT 1',
      )
      .get(coworkSessionId) as SessionMappingRow | undefined;
    if (!row) return null;
    return {
      imConversationId: row.im_conversation_id,
      platform: row.platform as Platform,
      coworkSessionId: row.cowork_session_id,
      ...(row.transport_session_key ? { transportSessionKey: row.transport_session_key } : {}),
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    };
  }

  /**
   * Create a new session mapping
   */
  createSessionMapping(
    imConversationId: string,
    platform: Platform,
    coworkSessionId: string,
    transportSessionKey: string = '',
  ): IMSessionMapping {
    const now = Date.now();
    const normalizedTransportSessionKey = transportSessionKey.trim();
    this.db
      .prepare(
        'INSERT INTO channel_session_mappings (im_conversation_id, platform, cowork_session_id, transport_session_key, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        imConversationId,
        platform,
        coworkSessionId,
        normalizedTransportSessionKey || null,
        now,
        now,
      );
    return {
      imConversationId,
      platform,
      coworkSessionId,
      ...(normalizedTransportSessionKey
        ? { transportSessionKey: normalizedTransportSessionKey }
        : {}),
      createdAt: now,
      lastActiveAt: now,
    };
  }

  /**
   * Update last active time for a session mapping
   */
  updateSessionLastActive(imConversationId: string, platform: Platform): void {
    const now = Date.now();
    this.db
      .prepare(
        'UPDATE channel_session_mappings SET last_active_at = ? WHERE im_conversation_id = ? AND platform = ?',
      )
      .run(now, imConversationId, platform);
  }

  updateSessionTransportSessionKey(
    imConversationId: string,
    platform: Platform,
    transportSessionKey: string,
  ): void {
    const normalizedKey = transportSessionKey.trim();
    if (!normalizedKey) {
      return;
    }
    const now = Date.now();
    this.db
      .prepare(
        'UPDATE channel_session_mappings SET transport_session_key = ?, last_active_at = ? WHERE im_conversation_id = ? AND platform = ?',
      )
      .run(normalizedKey, now, imConversationId, platform);
  }

  /**
   * Delete a session mapping
   */
  deleteSessionMapping(imConversationId: string, platform: Platform): void {
    this.db
      .prepare('DELETE FROM channel_session_mappings WHERE im_conversation_id = ? AND platform = ?')
      .run(imConversationId, platform);
  }

  /**
   * Delete all session mappings that reference a given cowork session ID.
   * Called when a cowork session is deleted so that the IM conversation
   * can be re-synced as a fresh session.
   */
  deleteSessionMappingByCoworkSessionId(coworkSessionId: string): void {
    this.db
      .prepare('DELETE FROM channel_session_mappings WHERE cowork_session_id = ?')
      .run(coworkSessionId);
  }

  /** List session mappings, optionally scoped to the owning pi-connect account. */
  listSessionMappings(platform?: Platform, accountId?: string): IMSessionMapping[] {
    let query: string;
    let params: unknown[];

    if (platform) {
      query =
        'SELECT im_conversation_id, platform, cowork_session_id, transport_session_key, created_at, last_active_at FROM channel_session_mappings WHERE platform = ? ORDER BY last_active_at DESC';
      params = [platform];
    } else {
      query =
        'SELECT im_conversation_id, platform, cowork_session_id, transport_session_key, created_at, last_active_at FROM channel_session_mappings ORDER BY last_active_at DESC';
      params = [];
    }

    const rows = this.db.prepare(query).all(...params) as SessionMappingRow[];
    return rows
      .filter(row => {
        if (!accountId) return true;
        return tryParseCcConnectScopedConversationId(row.im_conversation_id)?.[0] === accountId;
      })
      .map(row => ({
        imConversationId: row.im_conversation_id,
        platform: row.platform as Platform,
        coworkSessionId: row.cowork_session_id,
        ...(row.transport_session_key ? { transportSessionKey: row.transport_session_key } : {}),
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at,
      }));
  }
}

function ccConnectSessionRouteKey(
  accountId: string,
  platform: string,
  conversationId: string,
): string {
  const values = [accountId, platform, conversationId].map(value => value.trim());
  if (values.some(value => !value))
    throw new Error('cc-connect session route identity is required');
  return `cc_connect_session_route:${Buffer.from(JSON.stringify(values)).toString('base64url')}`;
}
