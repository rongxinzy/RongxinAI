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

test('isMultiInstancePlatform matches the four active multi-instance platforms', () => {
  expect(isMultiInstancePlatform('dingtalk')).toBe(true);
  expect(isMultiInstancePlatform('feishu')).toBe(true);
  expect(isMultiInstancePlatform('qq')).toBe(true);
  expect(isMultiInstancePlatform('wecom')).toBe(true);
  expect(isMultiInstancePlatform('weixin')).toBe(false);
  expect(isMultiInstancePlatform('telegram')).toBe(false);
  expect(isMultiInstancePlatform('discord')).toBe(false);
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
  expect(canStartIMPlatform(config, 'qq')).toBe(false);
  expect(canStartIMPlatform(config, 'wecom')).toBe(true);
  expect(canStartIMPlatform(config, 'feishu')).toBe(true);
  expect(canStartIMPlatform(config, 'telegram')).toBe(false);
  expect(canStartIMPlatform(config, 'discord')).toBe(false);
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

  for (const platform of ['weixin', 'dingtalk', 'qq', 'feishu', 'wecom'] as const) {
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
    weixin: { ...DEFAULT_IM_STATUS.weixin, connected: true },
  };

  expect(getIMPlatformConnected(DEFAULT_IM_STATUS, 'dingtalk')).toBe(false);
  expect(getIMPlatformConnected(status, 'dingtalk')).toBe(true);
  expect(getIMPlatformConnected(status, 'weixin')).toBe(true);
  expect(getIMPlatformConnected(DEFAULT_IM_STATUS, 'qq')).toBe(false);
});

test('getIMPlatformStarting returns false for active platforms', () => {
  expect(getIMPlatformStarting(DEFAULT_IM_STATUS, 'weixin')).toBe(false);
  expect(getIMPlatformStarting(DEFAULT_IM_STATUS, 'dingtalk')).toBe(false);
});

test('getNavInstances and getNavInstanceStatuses map each active platform to its own list', () => {
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
  expect(getNavInstanceStatuses(DEFAULT_IM_STATUS, 'wecom')).toEqual([]);
});
