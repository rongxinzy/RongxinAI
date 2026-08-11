import { expect, test } from 'vitest';

import { listCcConnectAccountConfigs } from './ccConnectAccountConfig';

const disabled = { enabled: false, instanceId: 'disabled0000', botToken: '', clientId: '', clientSecret: '', appId: '', appSecret: '', botId: '', secret: '', allowFrom: [], proxy: '', domain: 'feishu' };

test('maps only enabled accounts with complete, platform-native credentials', () => {
  const accounts = listCcConnectAccountConfigs({
    getTelegramInstances: () => [{ ...disabled, enabled: true, instanceId: 'telegram-123456', botToken: 'token', allowFrom: ['42'], proxy: 'socks5://127.0.0.1:1080' }],
    getDiscordInstances: () => [{ ...disabled, enabled: true, instanceId: 'discord-123456', botToken: 'discord-token' }],
    getDingTalkInstances: () => [{ ...disabled, enabled: true, instanceId: 'dingtalk-123456', clientId: 'id', clientSecret: 'secret' }],
    getFeishuInstances: () => [{ ...disabled, enabled: true, instanceId: 'feishu-123456', appId: 'app', appSecret: 'secret', domain: 'lark' }],
    getQQInstances: () => [{ ...disabled, enabled: true, instanceId: 'qq-123456', appId: 'app', appSecret: 'secret' }],
    getWecomInstances: () => [{ ...disabled, enabled: true, instanceId: 'wecom-123456', botId: 'bot', secret: 'secret' }, { ...disabled, enabled: true, instanceId: 'bad-123456', botId: 'bot' }],
  } as never);
  expect(accounts).toEqual(expect.arrayContaining([
    expect.objectContaining({ accountId: 'telegram', platform: 'telegram', options: expect.objectContaining({ token: 'token', allow_from: ['42'] }) }),
    expect.objectContaining({ accountId: 'discord-', platform: 'discord' }),
    expect.objectContaining({ accountId: 'dingtalk', platform: 'dingtalk' }),
    expect.objectContaining({ accountId: 'feishu-1', platform: 'feishu', options: expect.objectContaining({ domain: 'lark' }) }),
    expect.objectContaining({ accountId: 'qq-12345', platform: 'qqbot' }),
    expect.objectContaining({ accountId: 'wecom-12', platform: 'wecom' }),
  ]));
  expect(accounts).toHaveLength(6);
});
