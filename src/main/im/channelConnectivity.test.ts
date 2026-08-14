import { expect, test } from 'vitest';

import type { IMGatewayConfig } from './types';
import {
  appendRuntimeConnectivity,
  resolveFeishuAuthEndpoint,
  resolveConnectivityAccount,
  selectConnectivityInstance,
} from './channelConnectivity';
import { ConnectivityCheckCode, ConnectivityCheckLevel } from './constants';

test('uses the matching authentication endpoint for Feishu and Lark', () => {
  expect(resolveFeishuAuthEndpoint('feishu')).toContain('open.feishu.cn');
  expect(resolveFeishuAuthEndpoint('lark')).toContain('open.larksuite.com');
  expect(resolveFeishuAuthEndpoint('https://open.example.invalid')).toBe(
    'https://open.example.invalid/open-apis/auth/v3/tenant_access_token/internal',
  );
  expect(() => resolveFeishuAuthEndpoint('invalid-domain')).toThrow();
});

const config = {
  telegram: {
    instances: [
      { instanceId: 'disabled-account', enabled: false },
      { instanceId: 'enabled-account-with-complete-uuid', enabled: true },
    ],
  },
  weixin: { accountId: 'weixin-native-account', enabled: true },
} as IMGatewayConfig;

test('resolves the requested complete account identity for multi-instance channels', () => {
  expect(resolveConnectivityAccount('telegram', config, 'disabled-account')).toEqual({
    accountId: 'disabled-account',
    enabled: false,
  });
  expect(resolveConnectivityAccount('telegram', config)).toEqual({
    accountId: 'enabled-account-with-complete-uuid',
    enabled: true,
  });
  expect(resolveConnectivityAccount('weixin', config)).toEqual({
    accountId: 'weixin-native-account',
    enabled: true,
  });
  expect(resolveConnectivityAccount('telegram', config, 'missing-account')).toEqual({
    accountId: 'missing-account',
    enabled: false,
  });
  expect(selectConnectivityInstance(config.telegram.instances, 'missing-account')).toBeUndefined();
});

test('requires an enabled account to be ready in the sidecar', () => {
  const result = appendRuntimeConnectivity(
    {
      platform: 'telegram',
      testedAt: Date.now(),
      verdict: ConnectivityCheckLevel.Pass,
      checks: [
        { code: ConnectivityCheckCode.Auth, level: ConnectivityCheckLevel.Pass, message: 'ok' },
      ],
    },
    { accountId: 'enabled-account-with-complete-uuid', enabled: true },
    {
      connected: false,
      lastError: 'stream disconnected',
      startedAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    },
  );
  expect(result.verdict).toBe(ConnectivityCheckLevel.Fail);
  expect(result.checks.at(-1)).toMatchObject({
    code: ConnectivityCheckCode.RuntimeUnavailable,
    level: ConnectivityCheckLevel.Fail,
  });
});

test('reports disabled accounts without treating expected inactivity as a failure', () => {
  const result = appendRuntimeConnectivity(
    {
      platform: 'telegram',
      testedAt: Date.now(),
      verdict: ConnectivityCheckLevel.Pass,
      checks: [
        { code: ConnectivityCheckCode.Auth, level: ConnectivityCheckLevel.Pass, message: 'ok' },
      ],
    },
    { accountId: 'disabled-account', enabled: false },
    null,
  );
  expect(result.verdict).toBe(ConnectivityCheckLevel.Warn);
  expect(result.checks.at(-1)).toMatchObject({
    code: ConnectivityCheckCode.RuntimeUnavailable,
    level: ConnectivityCheckLevel.Info,
  });
});

test('reports a ready sidecar account as connected', () => {
  const result = appendRuntimeConnectivity(
    {
      platform: 'telegram',
      testedAt: Date.now(),
      verdict: ConnectivityCheckLevel.Pass,
      checks: [
        { code: ConnectivityCheckCode.Auth, level: ConnectivityCheckLevel.Pass, message: 'ok' },
      ],
    },
    { accountId: 'enabled-account-with-complete-uuid', enabled: true },
    {
      connected: true,
      lastError: null,
      startedAt: Date.now(),
      lastInboundAt: null,
      lastOutboundAt: null,
    },
  );
  expect(result.verdict).toBe(ConnectivityCheckLevel.Pass);
  expect(result.checks.at(-1)).toMatchObject({
    code: ConnectivityCheckCode.RuntimeReady,
    level: ConnectivityCheckLevel.Pass,
  });
});
