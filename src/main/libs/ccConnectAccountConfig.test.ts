import { expect, test } from 'vitest';

import { listCcConnectAccountConfigs } from './ccConnectAccountConfig';

const disabled = {
  enabled: false,
  instanceId: 'disabled0000',
  workspaceId: 'workspace-1',
  botToken: '',
  clientId: '',
  clientSecret: '',
  appId: '',
  appSecret: '',
  botId: '',
  secret: '',
  allowFrom: [],
  proxy: '',
  domain: 'feishu',
};

test('maps only enabled accounts with complete, platform-native credentials', () => {
  const accounts = listCcConnectAccountConfigs({
    getTelegramInstances: () => [
      {
        ...disabled,
        enabled: true,
        instanceId: 'telegram-123456',
        botToken: 'token',
        dmPolicy: 'allowlist',
        allowFrom: ['42'],
        groupPolicy: 'allowlist',
        groupAllowFrom: ['group-7'],
        mediaMaxMb: 20,
        proxy: 'socks5://127.0.0.1:1080',
      },
    ],
    getDiscordInstances: () => [
      { ...disabled, enabled: true, instanceId: 'discord-123456', botToken: 'discord-token' },
    ],
    getDingTalkInstances: () => [
      {
        ...disabled,
        enabled: true,
        instanceId: 'dingtalk-123456',
        clientId: 'id',
        clientSecret: 'secret',
      },
    ],
    getFeishuInstances: () => [
      {
        ...disabled,
        enabled: true,
        instanceId: 'feishu-123456',
        appId: 'app',
        appSecret: 'secret',
        domain: 'lark',
      },
    ],
    getQQInstances: () => [
      { ...disabled, enabled: true, instanceId: 'qq-123456', appId: 'app', appSecret: 'secret' },
    ],
    getWecomInstances: () => [
      { ...disabled, enabled: true, instanceId: 'wecom-123456', botId: 'bot', secret: 'secret' },
      { ...disabled, enabled: true, instanceId: 'bad-123456', botId: 'bot' },
    ],
    getWeixinConfig: () => ({
      enabled: true,
      accountId: 'weixin-account',
      workspaceId: 'workspace-1',
      token: 'weixin-token',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      allowFrom: ['wx-user'],
    }),
  } as never);
  expect(accounts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        accountId: 'telegram-123456',
        platform: 'telegram',
        options: expect.objectContaining({
          token: 'token',
          dm_policy: 'allowlist',
          dm_allow_from: '42',
          group_policy: 'allowlist',
          group_allow_from: 'group-7',
          media_max_mb: 20,
        }),
      }),
      expect.objectContaining({ accountId: 'discord-123456', platform: 'discord' }),
      expect.objectContaining({ accountId: 'dingtalk-123456', platform: 'dingtalk' }),
      expect.objectContaining({
        accountId: 'feishu-123456',
        platform: 'feishu',
        options: expect.objectContaining({ domain: 'lark' }),
      }),
      expect.objectContaining({ accountId: 'qq-123456', platform: 'qqbot' }),
      expect.objectContaining({
        accountId: 'wecom-123456',
        platform: 'wecom',
        options: expect.objectContaining({
          mode: 'websocket',
          bot_id: 'bot',
          bot_secret: 'secret',
        }),
      }),
      expect.objectContaining({
        accountId: 'weixin-account',
        platform: 'weixin',
        options: expect.objectContaining({
          token: 'weixin-token',
          dm_allow_from: 'wx-user',
          group_allow_from: 'wx-user',
        }),
      }),
    ]),
  );
  expect(accounts).toHaveLength(7);
});

test('omits enabled accounts without a workspace binding', () => {
  const accounts = listCcConnectAccountConfigs({
    getTelegramInstances: () => [
      { ...disabled, enabled: true, workspaceId: '', botToken: 'token' },
    ],
    getDiscordInstances: () => [],
    getDingTalkInstances: () => [],
    getFeishuInstances: () => [],
    getQQInstances: () => [],
    getWecomInstances: () => [],
    getWeixinConfig: () => ({
      enabled: true,
      accountId: 'weixin-account',
      workspaceId: '',
      token: 'token',
    }),
  } as never);

  expect(accounts).toEqual([]);
});

test('omits enabled accounts whose workspace no longer exists', () => {
  const accounts = listCcConnectAccountConfigs(
    {
      getTelegramInstances: () => [{ ...disabled, enabled: true, botToken: 'token' }],
      getDiscordInstances: () => [],
      getDingTalkInstances: () => [],
      getFeishuInstances: () => [],
      getQQInstances: () => [],
      getWecomInstances: () => [],
      getWeixinConfig: () => ({ enabled: false }),
    } as never,
    () => false,
  );

  expect(accounts).toEqual([]);
});
