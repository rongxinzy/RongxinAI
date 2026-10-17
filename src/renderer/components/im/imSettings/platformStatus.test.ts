import { expect, test } from 'vitest';

import type { IMGatewayConfig, IMGatewayStatus } from '../../../types/im';
import { DEFAULT_IM_CONFIG, DEFAULT_IM_STATUS } from '../../../types/im';
import {
  canStartIMPlatform,
  getIMPlatformConnected,
  getIMPlatformStarting,
  getNavInstances,
  getNavInstanceStatuses,
  isIMPlatformEnabled,
  isMultiInstancePlatform,
} from './platformStatus';

// Minimal instance/status fixtures: only the fields read by the helpers under
// test are relevant, so cast partials instead of spelling out full configs.
const instance = (fields: Record<string, unknown>): never => fields as never;
const instanceStatus = (fields: Record<string, unknown>): never => fields as never;

test('isMultiInstancePlatform matches the six multi-instance platforms', () => {
  expect(isMultiInstancePlatform('dingtalk')).toBe(true);
  expect(isMultiInstancePlatform('feishu')).toBe(true);
  expect(isMultiInstancePlatform('qq')).toBe(true);
  expect(isMultiInstancePlatform('wecom')).toBe(true);
  expect(isMultiInstancePlatform('telegram')).toBe(true);
  expect(isMultiInstancePlatform('discord')).toBe(true);
  expect(isMultiInstancePlatform('weixin')).toBe(false);
});

test('canStartIMPlatform: weixin needs no credentials', () => {
  expect(canStartIMPlatform(DEFAULT_IM_CONFIG, 'weixin')).toBe(true);
});

test('canStartIMPlatform requires credentials on at least one instance', () => {
  const config: IMGatewayConfig = {
    ...DEFAULT_IM_CONFIG,
    dingtalk: {
      instances: [
        instance({ instanceId: 'a', enabled: false, clientId: '', clientSecret: '' }),
        instance({ instanceId: 'b', enabled: false, clientId: 'id', clientSecret: 'secret' }),
      ],
    },
    telegram: { instances: [instance({ instanceId: 't', enabled: false, botToken: '' })] as any },
    discord: {
      instances: [instance({ instanceId: 'd', enabled: false, botToken: 'token' })] as any,
    },
    qq: {
      instances: [instance({ instanceId: 'q', enabled: false, appId: 'a', appSecret: '' })] as any,
    },
    wecom: {
      instances: [instance({ instanceId: 'w', enabled: false, botId: 'b', secret: 's' })] as any,
    },
    feishu: {
      instances: [instance({ instanceId: 'f', enabled: false, appId: 'app', appSecret: 'sec' })],
    },
  };

  expect(canStartIMPlatform(config, 'dingtalk')).toBe(true);
  expect(canStartIMPlatform(config, 'telegram')).toBe(false);
  expect(canStartIMPlatform(config, 'discord')).toBe(true);
  expect(canStartIMPlatform(config, 'qq')).toBe(false);
  expect(canStartIMPlatform(config, 'wecom')).toBe(true);
  expect(canStartIMPlatform(config, 'feishu')).toBe(true);
});

test('isIMPlatformEnabled reads the persisted enabled flag per platform', () => {
  const enabledConfig: IMGatewayConfig = {
    ...DEFAULT_IM_CONFIG,
    dingtalk: {
      instances: [
        instance({ instanceId: 'a', enabled: false }),
        instance({ instanceId: 'b', enabled: true }),
      ],
    },
    qq: { instances: [instance({ instanceId: 'q', enabled: true })] as any },
    weixin: { ...DEFAULT_IM_CONFIG.weixin, enabled: true },
  };

  // Defaults: nothing enabled anywhere.
  for (const platform of [
    'weixin',
    'dingtalk',
    'qq',
    'feishu',
    'wecom',
    'telegram',
    'discord',
  ] as const) {
    expect(isIMPlatformEnabled(DEFAULT_IM_CONFIG, platform)).toBe(false);
  }

  expect(isIMPlatformEnabled(enabledConfig, 'dingtalk')).toBe(true);
  expect(isIMPlatformEnabled(enabledConfig, 'qq')).toBe(true);
  expect(isIMPlatformEnabled(enabledConfig, 'weixin')).toBe(true);
});

test('getIMPlatformConnected reflects any connected instance or weixin runtime status', () => {
  const status: IMGatewayStatus = {
    ...DEFAULT_IM_STATUS,
    dingtalk: {
      instances: [
        instanceStatus({ instanceId: 'a', connected: false }),
        instanceStatus({ instanceId: 'b', connected: true }),
      ],
    },
    discord: {
      instances: [instanceStatus({ instanceId: 'd', connected: false, starting: true })],
    },
    weixin: { ...DEFAULT_IM_STATUS.weixin, connected: true },
  };

  expect(getIMPlatformConnected(DEFAULT_IM_STATUS, 'dingtalk')).toBe(false);
  expect(getIMPlatformConnected(status, 'dingtalk')).toBe(true);
  expect(getIMPlatformConnected(status, 'discord')).toBe(false);
  expect(getIMPlatformConnected(status, 'weixin')).toBe(true);
  expect(getIMPlatformConnected(DEFAULT_IM_STATUS, 'qq')).toBe(false);
});

test('getIMPlatformStarting only reports discord first-instance starting state', () => {
  const status: IMGatewayStatus = {
    ...DEFAULT_IM_STATUS,
    discord: {
      instances: [instanceStatus({ instanceId: 'd', connected: false, starting: true })],
    },
  };

  expect(getIMPlatformStarting(status, 'discord')).toBe(true);
  expect(getIMPlatformStarting(DEFAULT_IM_STATUS, 'discord')).toBe(false);
  expect(getIMPlatformStarting(status, 'weixin')).toBe(false);
  expect(getIMPlatformStarting(status, 'telegram')).toBe(false);
});

test('getNavInstances and getNavInstanceStatuses map each platform to its own list', () => {
  const config: IMGatewayConfig = {
    ...DEFAULT_IM_CONFIG,
    dingtalk: {
      instances: [instance({ instanceId: 'dt-1', instanceName: 'DingTalk Bot', enabled: true })],
    },
  };
  const status: IMGatewayStatus = {
    ...DEFAULT_IM_STATUS,
    dingtalk: {
      instances: [instanceStatus({ instanceId: 'dt-1', connected: false })],
    },
  };

  expect(getNavInstances(config, 'dingtalk')).toEqual([
    { instanceId: 'dt-1', instanceName: 'DingTalk Bot', enabled: true },
  ]);
  expect(getNavInstances(config, 'qq')).toEqual([]);
  expect(getNavInstanceStatuses(status, 'dingtalk')).toEqual([
    { instanceId: 'dt-1', connected: false },
  ]);
  expect(getNavInstanceStatuses(DEFAULT_IM_STATUS, 'telegram')).toEqual([]);
});
