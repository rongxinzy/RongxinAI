import { expect, test } from 'vitest';

import { buildAnthropicMessagesUrl } from './apiUrl';

test('builds Anthropic messages URLs without duplicating version segments', () => {
  expect(buildAnthropicMessagesUrl('https://example.com')).toBe(
    'https://example.com/v1/messages',
  );
  expect(buildAnthropicMessagesUrl('https://example.com/v1/')).toBe(
    'https://example.com/v1/messages',
  );
  expect(buildAnthropicMessagesUrl('https://example.com/v1/messages')).toBe(
    'https://example.com/v1/messages',
  );
});
