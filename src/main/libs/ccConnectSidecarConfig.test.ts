import { expect, test } from 'vitest';

import { serializeCcConnectSidecarConfig } from './ccConnectSidecarConfig';
import { SchedulerClockAccount } from '../../scheduledTask/ccConnectCronClient';

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

test('accepts qqbot, the cc-connect QQ adapter identifier', () => {
  expect(() => serializeCcConnectSidecarConfig({
    ...base,
    projects: [{ accountId: 'qq-primary', platform: 'qqbot', options: { app_id: 'id', app_secret: 'secret' } }],
  })).not.toThrow();
});

test('serializes multiple account projects into one channel runtime', () => {
  const config = serializeCcConnectSidecarConfig({ ...base, projects: [
    { accountId: 'a', platform: 'dingtalk', options: { client_id: 'id-a', client_secret: 'secret-a' } },
    { accountId: 'b', platform: 'dingtalk', options: { client_id: 'id-b', client_secret: 'secret-b' } },
  ] });
  expect(config.match(/\[\[projects\]\]/g)).toHaveLength(2);
  expect(config).toContain('name = "a"');
  expect(config).toContain('name = "b"');
});

test('rejects remote control planes, unsupported platforms, and unsafe option keys', () => {
  expect(() => serializeCcConnectSidecarConfig({ ...base, bridgeUrl: 'http://10.0.0.1:1234', projects: [] })).toThrow('loopback');
  expect(() => serializeCcConnectSidecarConfig({ ...base, projects: [] })).toThrow('requires a project');
  expect(() => serializeCcConnectSidecarConfig({ ...base, projects: [{ accountId: 'a', platform: 'slack', options: {} }] })).toThrow('Unsupported');
  expect(() => serializeCcConnectSidecarConfig({ ...base, projects: [{ accountId: 'a', platform: 'qq', options: { 'bad.key': 'x' } }] })).toThrow('Unsafe');
});

test('serializes a credential-free scheduler clock without channel platforms', () => {
  const config = serializeCcConnectSidecarConfig({
    ...base,
    projects: [{ accountId: SchedulerClockAccount }],
  });
  expect(config).toContain(`name = "${SchedulerClockAccount}"`);
  expect(config).toContain('cron_control_listen = "127.0.0.1:0"');
  expect(config).not.toContain('[[projects.platforms]]');
  expect(config).not.toContain('[projects.platforms.options]');
});
