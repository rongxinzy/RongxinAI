import { expect, test } from 'vitest';

import {
  extractLatestTodoListFromMessages,
  extractTodoListFromLatestAssistantMessage,
  extractTodosFromMessages,
} from './todoParser';

test('returns the newest checklist with its source message', () => {
  const result = extractLatestTodoListFromMessages([
    {
      id: 'older',
      type: 'assistant',
      content: '- [ ] older task',
      timestamp: 10,
    },
    {
      id: 'answer',
      type: 'assistant',
      content: 'No checklist in this answer.',
      timestamp: 20,
    },
    {
      id: 'newer',
      type: 'assistant',
      content: '- [x] newer task',
      timestamp: 30,
    },
  ]);

  expect(result).toEqual({
    sourceMessageId: 'newer',
    sourceTimestamp: 30,
    todos: [
      expect.objectContaining({
        status: 'completed',
        title: 'newer task',
      }),
    ],
  });
});

test('does not skip a completed newest checklist to revive an older pending list', () => {
  const todos = extractTodosFromMessages([
    {
      id: 'older',
      type: 'assistant',
      content: '- [ ] older task',
      timestamp: 10,
    },
    {
      id: 'newer',
      type: 'assistant',
      content: '- [x] completed task',
      timestamp: 20,
    },
  ]);

  expect(todos).toEqual([
    expect.objectContaining({
      status: 'completed',
      title: 'completed task',
    }),
  ]);
});

test('does not parse an older checklist during a live message update', () => {
  const result = extractTodoListFromLatestAssistantMessage([
    {
      id: 'todo',
      type: 'assistant',
      content: '- [ ] active task',
      timestamp: 10,
    },
    {
      id: 'answer',
      type: 'assistant',
      content: 'Streaming answer without a checklist.',
      timestamp: 20,
    },
  ]);

  expect(result).toBeNull();
});
