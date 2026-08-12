import { expect, test } from 'vitest';

import {
  buildManagedSessionKey,
  isManagedSessionKey,
  parseChannelSessionKey,
  parseManagedSessionKey,
} from './channelSessionKey';

test('managed session keys round-trip session IDs containing colons', () => {
  const key = buildManagedSessionKey('session:with:colons', 'agent-2');

  expect(key).toBe('agent:agent-2:zhiyuan:session:with:colons');
  expect(parseManagedSessionKey(key)).toEqual({
    agentId: 'agent-2',
    sessionId: 'session:with:colons',
  });
  expect(isManagedSessionKey(key)).toBe(true);
});

test('legacy managed keys remain parseable without becoming channel routes', () => {
  expect(parseManagedSessionKey('zhiyuan:session-1')).toEqual({
    agentId: null,
    sessionId: 'session-1',
  });
  expect(parseChannelSessionKey('zhiyuan:session-1')).toBe(null);
});

test('channel session keys resolve native transport channels', () => {
  expect(parseChannelSessionKey('agent:main:weixin:bot-1:direct:user-1')).toEqual({
    platform: 'weixin',
    conversationId: 'bot-1:direct:user-1',
  });
  expect(parseChannelSessionKey('telegram:chat-42')).toEqual({
    platform: 'telegram',
    conversationId: 'chat-42',
  });
});

test('invalid and managed session keys are rejected as channel routes', () => {
  expect(parseChannelSessionKey('')).toBe(null);
  expect(parseChannelSessionKey('agent:main:zhiyuan:session-1')).toBe(null);
  expect(parseChannelSessionKey('unknown:conversation')).toBe(null);
});
