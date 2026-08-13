import { expect, test } from 'vitest';

import {
  getCcConnectScopedConversationId,
  parseCcConnectScopedConversationId,
  tryParseCcConnectScopedConversationId,
} from './ccConnectConversationId';

test('scopes the same native conversation independently for each account', () => {
  const first = getCcConnectScopedConversationId('account-one', 'chat:one');
  const second = getCcConnectScopedConversationId('account-two', 'chat:one');

  expect(first).not.toBe(second);
  expect(parseCcConnectScopedConversationId(first)).toEqual(['account-one', 'chat:one']);
});

test('rejects malformed and unscoped conversation IDs', () => {
  expect(() => parseCcConnectScopedConversationId('chat:one')).toThrow('invalid');
  expect(() => parseCcConnectScopedConversationId('cc-connect:e30')).toThrow('invalid');
  expect(tryParseCcConnectScopedConversationId('chat:one')).toBeNull();
});
