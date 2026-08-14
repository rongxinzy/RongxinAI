import type { IMStore } from '../im/imStore';

export type CcConnectAccountConfig = {
  accountId: string;
  platform: 'telegram' | 'discord' | 'dingtalk' | 'feishu' | 'lark' | 'qqbot' | 'wecom' | 'weixin';
  options: Readonly<Record<string, string | number | boolean | readonly string[]>>;
};

/**
 * Translates only the credential fields shared by the old account records and
 * the trimmed cc-connect platform adapters. Unsupported/credential-less
 * records are intentionally omitted instead of guessing a protocol config.
 */
export function listCcConnectAccountConfigs(
  store: Pick<
    IMStore,
    | 'getTelegramInstances'
    | 'getDiscordInstances'
    | 'getDingTalkInstances'
    | 'getFeishuInstances'
    | 'getQQInstances'
    | 'getWecomInstances'
    | 'getWeixinConfig'
  >,
  workspaceExists: (workspaceId: string) => boolean = workspaceId => Boolean(workspaceId.trim()),
): CcConnectAccountConfig[] {
  return [
    ...store.getTelegramInstances().flatMap(instance =>
      enabled(instance.enabled, workspaceExists, instance.workspaceId, instance.botToken)
        ? [
            {
              accountId: accountId(instance.instanceId),
              platform: 'telegram' as const,
              options: channelOptions(instance, {
                token: instance.botToken,
                proxy: instance.proxy,
              }),
            },
          ]
        : [],
    ),
    ...store.getDiscordInstances().flatMap(instance =>
      enabled(instance.enabled, workspaceExists, instance.workspaceId, instance.botToken)
        ? [
            {
              accountId: accountId(instance.instanceId),
              platform: 'discord' as const,
              options: channelOptions(instance, {
                token: instance.botToken,
                proxy: instance.proxy,
              }),
            },
          ]
        : [],
    ),
    ...store.getDingTalkInstances().flatMap(instance =>
      enabled(
        instance.enabled,
        workspaceExists,
        instance.workspaceId,
        instance.clientId,
        instance.clientSecret,
      )
        ? [
            {
              accountId: accountId(instance.instanceId),
              platform: 'dingtalk' as const,
              options: channelOptions(instance, {
                client_id: instance.clientId,
                client_secret: instance.clientSecret,
              }),
            },
          ]
        : [],
    ),
    ...store
      .getFeishuInstances()
      .flatMap(instance =>
        enabled(
          instance.enabled,
          workspaceExists,
          instance.workspaceId,
          instance.appId,
          instance.appSecret,
        )
          ? [feishuAccountConfig(instance)]
          : [],
      ),
    ...store.getQQInstances().flatMap(instance =>
      enabled(
        instance.enabled,
        workspaceExists,
        instance.workspaceId,
        instance.appId,
        instance.appSecret,
      )
        ? [
            {
              accountId: accountId(instance.instanceId),
              platform: 'qqbot' as const,
              options: channelOptions(instance, {
                app_id: instance.appId,
                app_secret: instance.appSecret,
              }),
            },
          ]
        : [],
    ),
    ...store.getWecomInstances().flatMap(instance =>
      enabled(
        instance.enabled,
        workspaceExists,
        instance.workspaceId,
        instance.botId,
        instance.secret,
      )
        ? [
            {
              accountId: accountId(instance.instanceId),
              platform: 'wecom' as const,
              options: channelOptions(instance, {
                mode: 'websocket',
                bot_id: instance.botId,
                bot_secret: instance.secret,
              }),
            },
          ]
        : [],
    ),
    ...(store.getWeixinConfig().enabled &&
    enabled(
      true,
      workspaceExists,
      store.getWeixinConfig().workspaceId,
      store.getWeixinConfig().accountId,
      store.getWeixinConfig().token,
    )
      ? [
          {
            accountId: accountId(store.getWeixinConfig().accountId),
            platform: 'weixin' as const,
            options: channelOptions(store.getWeixinConfig(), {
              token: store.getWeixinConfig().token,
              base_url: store.getWeixinConfig().baseUrl,
            }),
          },
        ]
      : []),
  ];
}

function feishuAccountConfig(instance: {
  instanceId: string;
  appId: string;
  appSecret: string;
  domain: string;
  dmPolicy?: string;
  allowFrom?: readonly string[];
  groupPolicy?: string;
  groupAllowFrom?: readonly string[];
  mediaMaxMb?: number;
}): CcConnectAccountConfig {
  const domain = instance.domain.trim();
  const service = domain.toLowerCase();
  const logicalService = service === 'feishu' || service === 'lark';
  return {
    accountId: accountId(instance.instanceId),
    platform: service === 'lark' ? 'lark' : 'feishu',
    options: channelOptions(instance, {
      app_id: instance.appId,
      app_secret: instance.appSecret,
      // pi-connect reserves domain for an absolute custom API base URL.
      domain: logicalService ? undefined : domain,
    }),
  };
}

function accountId(instanceId: string): string {
  return instanceId.trim();
}
function enabled(
  enabledFlag: boolean,
  workspaceExists: (workspaceId: string) => boolean,
  workspaceId: string,
  ...credentials: string[]
): boolean {
  return (
    enabledFlag &&
    workspaceExists(workspaceId) &&
    credentials.every(value => value.trim().length > 0)
  );
}
function allowFrom(value: readonly string[]): string | undefined {
  return value.length > 0 ? value.join(',') : undefined;
}
function channelOptions(
  config: {
    dmPolicy?: string;
    allowFrom?: readonly string[];
    groupPolicy?: string;
    groupAllowFrom?: readonly string[];
    mediaMaxMb?: number;
  },
  credentials: Record<string, string | readonly string[] | undefined>,
): Record<string, string | number | boolean | readonly string[]> {
  return options({
    ...credentials,
    dm_policy: config.dmPolicy,
    dm_allow_from: allowFrom(config.allowFrom ?? []),
    group_policy: config.groupPolicy,
    group_allow_from: allowFrom(config.groupAllowFrom ?? config.allowFrom ?? []),
    media_max_mb: config.mediaMaxMb,
  });
}
function options(
  value: Record<string, string | number | boolean | readonly string[] | undefined>,
): Record<string, string | number | boolean | readonly string[]> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ''),
  ) as Record<string, string | number | boolean | readonly string[]>;
}
