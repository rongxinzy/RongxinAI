import { expect, test } from 'vitest';

import { getCcConnectScopedConversationId } from './ccConnectPiBridge';

test('separates the same platform conversation for distinct ChannelAccounts', () => {
  const first = getCcConnectScopedConversationId('telegram-primary', 'chat-1');
  const second = getCcConnectScopedConversationId('telegram-secondary', 'chat-1');
  expect(first).not.toBe(second);
  expect(first).toMatch(/^cc-connect:[A-Za-z0-9_-]+$/);
});

test('rejects missing bridge account or conversation identity', () => {
  expect(() => getCcConnectScopedConversationId('', 'chat-1')).toThrow('required');
  expect(() => getCcConnectScopedConversationId('account', '  ')).toThrow('required');
});
