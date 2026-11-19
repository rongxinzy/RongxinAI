import { expect, test } from 'vitest';

import { parseManagedSessionKey } from './channelSessionKey';

test('parses managed session keys containing colons in the session ID', () => {
  expect(parseManagedSessionKey('zhiyuan:session:with:colons')).toEqual({
    sessionId: 'session:with:colons',
  });
});

test('parses a managed session key', () => {
  expect(parseManagedSessionKey('zhiyuan:session-1')).toEqual({
    sessionId: 'session-1',
  });
});
