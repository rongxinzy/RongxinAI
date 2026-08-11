import { expect, test } from 'vitest';

import { serializeCcConnectSidecarConfig } from './ccConnectSidecarConfig';

const base = {
  dataDir: 'C:\\Users\\test\\AppData\\Local\\ZhiYuanAgent\\cc-connect',
  bridgeUrl: 'http://127.0.0.1:34567',
  bridgeToken: 'secret',
  cronControlListen: '127.0.0.1:0',
};

test('serializes only a ZhiYuan bridge project and disables upstream control planes', () => {
  const config = serializeCcConnectSidecarConfig({
    ...base,
    projects: [{ accountId: 'telegram-primary', platform: 'telegram', options: { token: 'token', allow_from: ['u1'] } }],
  });
  expect(config).toContain('type = "zhiyuan-bridge"');
  expect(config).toContain('bridge_url = "http://127.0.0.1:34567"');
  expect(config).toContain('[webhook]\nenabled = false');
  expect(config).toContain('[management]\nenabled = false');
  expect(config).not.toContain('provider');
  expect(config).not.toContain('command');
});

test('rejects remote control planes, unsupported platforms, and unsafe option keys', () => {
  expect(() => serializeCcConnectSidecarConfig({ ...base, bridgeUrl: 'http://10.0.0.1:1234', projects: [] })).toThrow('loopback');
  expect(() => serializeCcConnectSidecarConfig({ ...base, projects: [{ accountId: 'a', platform: 'slack', options: {} }] })).toThrow('Unsupported');
  expect(() => serializeCcConnectSidecarConfig({ ...base, projects: [{ accountId: 'a', platform: 'qq', options: { 'bad.key': 'x' } }] })).toThrow('Unsafe');
});
