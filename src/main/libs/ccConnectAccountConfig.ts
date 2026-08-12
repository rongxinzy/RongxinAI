import type { IMStore } from '../im/imStore';

export type CcConnectAccountConfig = {
  accountId: string;
  platform: 'telegram' | 'discord' | 'dingtalk' | 'feishu' | 'qqbot' | 'wecom' | 'weixin';
  options: Readonly<Record<string, string | readonly string[]>>;
};

/**
 * Translates only the credential fields shared by the old account records and
 * the trimmed cc-connect platform adapters. Unsupported/credential-less
 * records are intentionally omitted instead of guessing a protocol config.
 */
export function listCcConnectAccountConfigs(store: Pick<IMStore,
  'getTelegramInstances' | 'getDiscordInstances' | 'getDingTalkInstances' |
  'getFeishuInstances' | 'getQQInstances' | 'getWecomInstances' | 'getWeixinConfig'
>, workspaceExists: (workspaceId: string) => boolean = workspaceId => Boolean(workspaceId.trim())): CcConnectAccountConfig[] {
  return [
    ...store.getTelegramInstances().flatMap(instance => enabled(instance.enabled, workspaceExists, instance.workspaceId, instance.botToken) ? [{
      accountId: accountId(instance.instanceId), platform: 'telegram' as const,
      options: options({ token: instance.botToken, allow_from: allowFrom(instance.allowFrom), proxy: instance.proxy }),
    }] : []),
    ...store.getDiscordInstances().flatMap(instance => enabled(instance.enabled, workspaceExists, instance.workspaceId, instance.botToken) ? [{
      accountId: accountId(instance.instanceId), platform: 'discord' as const,
      options: options({ token: instance.botToken, allow_from: allowFrom(instance.allowFrom), proxy: instance.proxy }),
    }] : []),
    ...store.getDingTalkInstances().flatMap(instance => enabled(instance.enabled, workspaceExists, instance.workspaceId, instance.clientId, instance.clientSecret) ? [{
      accountId: accountId(instance.instanceId), platform: 'dingtalk' as const,
      options: options({ client_id: instance.clientId, client_secret: instance.clientSecret, allow_from: allowFrom(instance.allowFrom) }),
    }] : []),
    ...store.getFeishuInstances().flatMap(instance => enabled(instance.enabled, workspaceExists, instance.workspaceId, instance.appId, instance.appSecret) ? [{
      accountId: accountId(instance.instanceId), platform: 'feishu' as const,
      options: options({ app_id: instance.appId, app_secret: instance.appSecret, domain: instance.domain, allow_from: allowFrom(instance.allowFrom) }),
    }] : []),
    ...store.getQQInstances().flatMap(instance => enabled(instance.enabled, workspaceExists, instance.workspaceId, instance.appId, instance.appSecret) ? [{
      accountId: accountId(instance.instanceId), platform: 'qqbot' as const,
      options: options({ app_id: instance.appId, app_secret: instance.appSecret, allow_from: allowFrom(instance.allowFrom) }),
    }] : []),
    ...store.getWecomInstances().flatMap(instance => enabled(instance.enabled, workspaceExists, instance.workspaceId, instance.botId, instance.secret) ? [{
      accountId: accountId(instance.instanceId), platform: 'wecom' as const,
      options: options({ mode: 'websocket', bot_id: instance.botId, bot_secret: instance.secret, allow_from: allowFrom(instance.allowFrom) }),
    }] : []),
    ...(store.getWeixinConfig().enabled && enabled(true, workspaceExists, store.getWeixinConfig().workspaceId, store.getWeixinConfig().accountId, store.getWeixinConfig().token) ? [{
      accountId: accountId(store.getWeixinConfig().accountId), platform: 'weixin' as const,
      options: options({ token: store.getWeixinConfig().token, base_url: store.getWeixinConfig().baseUrl, allow_from: allowFrom(store.getWeixinConfig().allowFrom) }),
    }] : []),
  ];
}

function accountId(instanceId: string): string { return instanceId.trim(); }
function enabled(
  enabledFlag: boolean,
  workspaceExists: (workspaceId: string) => boolean,
  workspaceId: string,
  ...credentials: string[]
): boolean {
  return enabledFlag && workspaceExists(workspaceId) && credentials.every(value => value.trim().length > 0);
}
function allowFrom(value: readonly string[]): string | undefined {
  return value.length > 0 ? value.join(',') : undefined;
}
function options(value: Record<string, string | readonly string[] | undefined>): Record<string, string | readonly string[]> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== '')) as Record<string, string | readonly string[]>;
}
