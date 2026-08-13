import { expect, test } from 'vitest';

import {
  buildManagedSessionKey,
  isManagedSessionKey,
  parseChannelSessionKey,
  parseManagedSessionKey,
} from './channelSessionKey';

test('managed session keys round-trip session IDs containing colons', () => {
  const key = buildManagedSessionKey('session:with:colons');

  expect(key).toBe('zhiyuan:session:with:colons');
  expect(parseManagedSessionKey(key)).toEqual({
    sessionId: 'session:with:colons',
  });
  expect(isManagedSessionKey(key)).toBe(true);
});

test('managed keys do not become channel routes', () => {
  expect(parseManagedSessionKey('zhiyuan:session-1')).toEqual({
    sessionId: 'session-1',
  });
  expect(parseChannelSessionKey('zhiyuan:session-1')).toBe(null);
});

test('channel session keys resolve native transport channels', () => {
  expect(parseChannelSessionKey('telegram:chat-42')).toEqual({
    platform: 'telegram',
    conversationId: 'chat-42',
  });
});

test('invalid and managed session keys are rejected as channel routes', () => {
  expect(parseChannelSessionKey('')).toBe(null);
  expect(parseChannelSessionKey('unknown:conversation')).toBe(null);
});
