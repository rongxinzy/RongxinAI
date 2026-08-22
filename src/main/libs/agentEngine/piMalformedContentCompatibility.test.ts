import {
  AgentSession,
  estimateTokens,
  serializeConversation,
} from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';

test('patched Pi compaction tolerates malformed assistant content', () => {
  const malformedAssistant = {
    role: 'assistant',
    content: null,
  } as never;

  expect(estimateTokens(malformedAssistant)).toBe(0);
  expect(serializeConversation([malformedAssistant])).toBe('');
});

test('patched Pi last-assistant lookup ignores malformed content', () => {
  const getLastAssistantText = AgentSession.prototype.getLastAssistantText as (
    this: unknown,
  ) => string | undefined;

  expect(
    getLastAssistantText.call({
      messages: [{ role: 'assistant', content: null, stopReason: 'aborted' }],
    }),
  ).toBeUndefined();
  expect(
    getLastAssistantText.call({
      messages: [{ role: 'assistant', content: {}, stopReason: 'stop' }],
    }),
  ).toBeUndefined();
});
