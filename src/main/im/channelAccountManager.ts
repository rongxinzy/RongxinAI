import Database from 'better-sqlite3';

import { t } from '../i18n';
import { fetchJsonWithTimeout } from './http';
import { IMStore } from './imStore';
import type { IMGatewayConfigPatch } from './configPatch';
import type {
  IMConnectivityCheck,
  IMConnectivityTestResult,
  IMGatewayConfig,
  IMGatewayStatus,
  Platform,
} from './types';

const CONNECTIVITY_TIMEOUT_MS = 10_000;

export class ChannelAccountManager {
  private readonly imStore: IMStore;

  constructor(db: Database.Database) {
    this.imStore = new IMStore(db);
  }

  getConfig(): IMGatewayConfig {
    return this.imStore.getConfig();
  }

  getIMStore(): IMStore {
    return this.imStore;
  }

  setConfig(config: IMGatewayConfigPatch, _options?: { syncGateway?: boolean }): void {
    this.imStore.setConfig(config);
  }

  getStatus(
    runtimeStatus: (instanceId: string) => {
      connected: boolean;
      lastError: string | null;
      startedAt: number | null;
      lastInboundAt: number | null;
      lastOutboundAt: number | null;
    } = () => ({
      connected: false,
      lastError: null,
      startedAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    }),
  ): IMGatewayStatus {
    const config = this.getConfig();
    const common = <T extends { instanceId: string; instanceName: string; enabled: boolean }>(
      instances: T[],
      configured: (instance: T) => boolean,
    ): Array<{
      instanceId: string;
      instanceName: string;
      connected: boolean;
      startedAt: number | null;
      lastError: string | null;
      lastInboundAt: number | null;
      lastOutboundAt: number | null;
    }> =>
      instances.map(instance => ({
        instanceId: instance.instanceId,
        instanceName: instance.instanceName,
        ...(instance.enabled && configured(instance)
          ? runtimeStatus(instance.instanceId)
          : {
              connected: false,
              lastError: null,
              startedAt: null,
              lastInboundAt: null,
              lastOutboundAt: null,
            }),
      }));

    return {
      dingtalk: {
        instances: common(
          config.dingtalk.instances,
          item => !!(item.clientId && item.clientSecret),
        ),
      },
      feishu: {
        instances: common(config.feishu.instances, item => !!(item.appId && item.appSecret)).map(
          item => ({
            ...item,
            startedAt: item.startedAt === null ? null : new Date(item.startedAt).toISOString(),
            botOpenId: null as string | null,
            error: item.lastError,
          }),
        ),
      },
      telegram: {
        instances: common(config.telegram.instances, item => !!item.botToken).map(item => ({
          ...item,
          botUsername: null as string | null,
        })),
      },
      qq: { instances: common(config.qq.instances, item => !!(item.appId && item.appSecret)) },
      discord: {
        instances: common(config.discord.instances, item => !!item.botToken).map(item => ({
          ...item,
          starting: false,
          botUsername: null as string | null,
        })),
      },
      wecom: {
        instances: common(config.wecom.instances, item => !!(item.botId && item.secret)).map(
          item => ({
            ...item,
            botId:
              config.wecom.instances.find(source => source.instanceId === item.instanceId)?.botId ||
              null,
          }),
        ),
      },
      weixin: {
        ...(config.weixin.enabled && config.weixin.accountId
          ? runtimeStatus(config.weixin.accountId)
          : {
              connected: false,
              lastError: null,
              startedAt: null,
              lastInboundAt: null,
              lastOutboundAt: null,
            }),
      },
    };
  }

  async testGateway(
    platform: Platform,
    configOverride?: Partial<IMGatewayConfig>,
  ): Promise<IMConnectivityTestResult> {
    const config = { ...this.getConfig(), ...configOverride } as IMGatewayConfig;
    const testedAt = Date.now();
    const checks: IMConnectivityCheck[] = [];
    try {
      const message = await this.probe(platform, config);
      checks.push({ code: 'auth_check', level: 'pass', message });
    } catch (error) {
      checks.push({
        code: 'auth_check',
        level: 'fail',
        message: t('imAuthFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
        suggestion: t('imAuthFailedSuggestion'),
      });
    }
    return {
      platform,
      testedAt,
      verdict: checks.some(check => check.level === 'fail') ? 'fail' : 'pass',
      checks,
    };
  }

  private async probe(platform: Platform, config: IMGatewayConfig): Promise<string> {
    if (platform === 'telegram') {
      const instance =
        config.telegram.instances.find(item => item.enabled) ?? config.telegram.instances[0];
      if (!instance?.botToken) throw new Error('Bot token is required.');
      const result = await fetchJsonWithTimeout<{ ok?: boolean; description?: string }>(
        `https://api.telegram.org/bot${instance.botToken}/getMe`,
        {},
        CONNECTIVITY_TIMEOUT_MS,
      );
      if (!result.ok) throw new Error(result.description || 'Telegram authentication failed.');
    } else if (platform === 'discord') {
      const instance =
        config.discord.instances.find(item => item.enabled) ?? config.discord.instances[0];
      if (!instance?.botToken) throw new Error('Bot token is required.');
      await fetchJsonWithTimeout(
        'https://discord.com/api/v10/users/@me',
        {
          headers: { Authorization: `Bot ${instance.botToken}` },
        },
        CONNECTIVITY_TIMEOUT_MS,
      );
    } else if (platform === 'feishu') {
      const instance =
        config.feishu.instances.find(item => item.enabled) ?? config.feishu.instances[0];
      if (!instance?.appId || !instance.appSecret) throw new Error('App credentials are required.');
      const result = await this.verifyFeishuCredentials(instance.appId, instance.appSecret);
      if (!result.success) throw new Error(result.error || 'Feishu authentication failed.');
    } else if (platform === 'dingtalk') {
      const instance =
        config.dingtalk.instances.find(item => item.enabled) ?? config.dingtalk.instances[0];
      if (!instance?.clientId || !instance.clientSecret)
        throw new Error('App credentials are required.');
      const result = await this.verifyDingTalkCredentials(instance.clientId, instance.clientSecret);
      if (!result.success) throw new Error(result.error || 'DingTalk authentication failed.');
    } else if (platform === 'qq') {
      const instance = config.qq.instances.find(item => item.enabled) ?? config.qq.instances[0];
      if (!instance?.appId || !instance.appSecret) throw new Error('App credentials are required.');
      await fetchJsonWithTimeout(
        'https://bots.qq.com/app/getAppAccessToken',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: instance.appId, clientSecret: instance.appSecret }),
        },
        CONNECTIVITY_TIMEOUT_MS,
      );
    } else if (platform === 'wecom') {
      const instance =
        config.wecom.instances.find(item => item.enabled) ?? config.wecom.instances[0];
      if (!instance?.botId || !instance.secret) throw new Error('Bot credentials are required.');
    } else if (!config.weixin.accountId) {
      throw new Error('Weixin account is not configured.');
    }
    return t('imAuthSuccess');
  }

  async verifyFeishuCredentials(
    appId: string,
    appSecret: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await fetchJsonWithTimeout<{ code?: number; msg?: string }>(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        },
        CONNECTIVITY_TIMEOUT_MS,
      );
      return result.code === 0 ? { success: true } : { success: false, error: result.msg };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async verifyDingTalkCredentials(
    clientId: string,
    clientSecret: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await fetchJsonWithTimeout(
        `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(clientId)}&appsecret=${encodeURIComponent(clientSecret)}`,
        {},
        CONNECTIVITY_TIMEOUT_MS,
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async startDingTalkInstallQrcode(): Promise<{
    url: string;
    deviceCode: string;
    interval: number;
    expireIn: number;
  }> {
    const baseUrl = 'https://oapi.dingtalk.com';
    const init = await fetchJsonWithTimeout<{ errcode: number; errmsg?: string; nonce?: string }>(
      `${baseUrl}/app/registration/init`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'DING_DWS_CLAW' }),
      },
      CONNECTIVITY_TIMEOUT_MS,
    );
    if (init.errcode !== 0 || !init.nonce)
      throw new Error(init.errmsg || 'DingTalk registration init failed.');
    const result = await fetchJsonWithTimeout<{
      errcode: number;
      errmsg?: string;
      device_code?: string;
      verification_uri_complete?: string;
      interval?: number;
      expires_in?: number;
    }>(
      `${baseUrl}/app/registration/begin`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: init.nonce }),
      },
      CONNECTIVITY_TIMEOUT_MS,
    );
    if (result.errcode !== 0 || !result.device_code || !result.verification_uri_complete)
      throw new Error(result.errmsg || 'DingTalk registration failed.');
    return {
      url: result.verification_uri_complete,
      deviceCode: result.device_code,
      interval: result.interval ?? 5,
      expireIn: result.expires_in ?? 600,
    };
  }

  async pollDingTalkInstall(
    deviceCode: string,
  ): Promise<{ done: boolean; clientId?: string; clientSecret?: string; error?: string }> {
    const result = await fetchJsonWithTimeout<{
      errcode: number;
      errmsg?: string;
      status?: string;
      client_id?: string;
      client_secret?: string;
      fail_reason?: string;
    }>(
      'https://oapi.dingtalk.com/app/registration/poll',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: deviceCode }),
      },
      CONNECTIVITY_TIMEOUT_MS,
    );
    if (result.errcode !== 0) return { done: false, error: result.errmsg };
    if (result.status === 'SUCCESS' && result.client_id && result.client_secret)
      return { done: true, clientId: result.client_id, clientSecret: result.client_secret };
    if (result.status === 'FAILED')
      return { done: false, error: result.fail_reason || result.errmsg };
    return { done: false };
  }
}
