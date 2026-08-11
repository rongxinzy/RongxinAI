import type { IMStore } from '../im/imStore';

export type CcConnectAccountConfig = {
  accountId: string;
  platform: 'telegram' | 'discord' | 'dingtalk' | 'feishu' | 'qqbot' | 'wecom';
  options: Readonly<Record<string, string | readonly string[]>>;
};

/**
 * Translates only the credential fields shared by the old account records and
 * the trimmed cc-connect platform adapters. Unsupported/credential-less
 * records are intentionally omitted instead of guessing a protocol config.
 */
export function listCcConnectAccountConfigs(store: Pick<IMStore,
  'getTelegramInstances' | 'getDiscordInstances' | 'getDingTalkInstances' |
  'getFeishuInstances' | 'getQQInstances' | 'getWecomInstances'
>): CcConnectAccountConfig[] {
  return [
    ...store.getTelegramInstances().flatMap(instance => enabled(instance.enabled, instance.botToken) ? [{
      accountId: accountId(instance.instanceId), platform: 'telegram' as const,
      options: options({ token: instance.botToken, allow_from: allowFrom(instance.allowFrom), proxy: instance.proxy }),
    }] : []),
    ...store.getDiscordInstances().flatMap(instance => enabled(instance.enabled, instance.botToken) ? [{
      accountId: accountId(instance.instanceId), platform: 'discord' as const,
      options: options({ token: instance.botToken, allow_from: allowFrom(instance.allowFrom), proxy: instance.proxy }),
    }] : []),
    ...store.getDingTalkInstances().flatMap(instance => enabled(instance.enabled, instance.clientId, instance.clientSecret) ? [{
      accountId: accountId(instance.instanceId), platform: 'dingtalk' as const,
      options: options({ client_id: instance.clientId, client_secret: instance.clientSecret, allow_from: allowFrom(instance.allowFrom) }),
    }] : []),
    ...store.getFeishuInstances().flatMap(instance => enabled(instance.enabled, instance.appId, instance.appSecret) ? [{
      accountId: accountId(instance.instanceId), platform: 'feishu' as const,
      options: options({ app_id: instance.appId, app_secret: instance.appSecret, domain: instance.domain, allow_from: allowFrom(instance.allowFrom) }),
    }] : []),
    ...store.getQQInstances().flatMap(instance => enabled(instance.enabled, instance.appId, instance.appSecret) ? [{
      accountId: accountId(instance.instanceId), platform: 'qqbot' as const,
      options: options({ app_id: instance.appId, app_secret: instance.appSecret, allow_from: allowFrom(instance.allowFrom) }),
    }] : []),
    ...store.getWecomInstances().flatMap(instance => enabled(instance.enabled, instance.botId, instance.secret) ? [{
      accountId: accountId(instance.instanceId), platform: 'wecom' as const,
      options: options({ bot_id: instance.botId, secret: instance.secret, allow_from: allowFrom(instance.allowFrom) }),
    }] : []),
  ];
}

function accountId(instanceId: string): string { return instanceId.slice(0, 8); }
function enabled(enabledFlag: boolean, ...credentials: string[]): boolean {
  return enabledFlag && credentials.every(value => value.trim().length > 0);
}
function allowFrom(value: readonly string[]): readonly string[] | undefined {
  return value.length > 0 ? value : undefined;
}
function options(value: Record<string, string | readonly string[] | undefined>): Record<string, string | readonly string[]> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== '')) as Record<string, string | readonly string[]>;
}
