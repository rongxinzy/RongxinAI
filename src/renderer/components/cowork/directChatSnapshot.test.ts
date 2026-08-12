import { expect, test } from 'vitest';

import { mergeDirectChatSnapshotMessages } from './directChatSnapshot';

test('preserves verified context usage when a transient message has the same id', () => {
  const messages = mergeDirectChatSnapshotMessages(
    [
      {
        id: 'assistant-1',
        type: 'assistant',
        content: 'complete response',
        timestamp: 1,
        metadata: {
          contextUsage: {
            usedTokens: 12,
            contextWindowTokens: 128,
            updatedAt: 2,
          },
          isFinal: true,
        },
      },
    ],
    [
      {
        id: 'assistant-1',
        type: 'assistant',
        content: 'complete response',
        timestamp: 3,
        metadata: { isFinal: true, isFinalAnswer: true },
      },
    ],
  );

  expect(messages).toEqual([
    {
      id: 'assistant-1',
      type: 'assistant',
      content: 'complete response',
      timestamp: 3,
      metadata: {
        contextUsage: {
          usedTokens: 12,
          contextWindowTokens: 128,
          updatedAt: 2,
        },
        isFinal: true,
        isFinalAnswer: true,
      },
    },
  ]);
});
