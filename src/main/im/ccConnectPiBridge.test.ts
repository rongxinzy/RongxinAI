import { expect, test } from 'vitest';

import {
  getCcConnectScopedConversationId,
  normalizeCcConnectPlatform,
  parseCcConnectScopedConversationId,
} from './ccConnectPiBridge';

test('normalizes Lark transport events to the Feishu product channel', () => {
  expect(normalizeCcConnectPlatform('lark')).toBe('feishu');
  expect(normalizeCcConnectPlatform('feishu')).toBe('feishu');
  expect(normalizeCcConnectPlatform('qqbot')).toBe('qq');
  expect(normalizeCcConnectPlatform('unknown')).toBeNull();
});

test('separates the same platform conversation for distinct ChannelAccounts', () => {
  const first = getCcConnectScopedConversationId('telegram-primary', 'chat-1');
  const second = getCcConnectScopedConversationId('telegram-secondary', 'chat-1');
  expect(first).not.toBe(second);
  expect(first).toMatch(/^cc-connect:[A-Za-z0-9_-]+$/);
});

test('recovers only a valid scoped account and native conversation pair', () => {
  const scoped = getCcConnectScopedConversationId('telegram-primary', 'chat-1');
  expect(parseCcConnectScopedConversationId(scoped)).toEqual(['telegram-primary', 'chat-1']);
  expect(() => parseCcConnectScopedConversationId('group:chat-1')).toThrow('invalid');
  expect(() => parseCcConnectScopedConversationId('cc-connect:e30')).toThrow('invalid');
});

test('rejects missing bridge account or conversation identity', () => {
  expect(() => getCcConnectScopedConversationId('', 'chat-1')).toThrow('required');
  expect(() => getCcConnectScopedConversationId('account', '  ')).toThrow('required');
});
