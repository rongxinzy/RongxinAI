import { expect, test, vi } from 'vitest';

import { CONVERSATION_HISTORY_TOOL_NAME, ConversationHistoryRole } from './constants';
import { buildPiConversationHistoryTool } from './piTool';

test('exposes a separate read-only conversation history tool', async () => {
  const search = vi.fn(() => [
    {
      messageId: 'message-1',
      sessionId: 'session-1',
      sessionTitle: 'CJK recall',
      role: ConversationHistoryRole.User,
      snippet: '项目决定使用 SQLite。',
      createdAt: Date.parse('2026-08-11T00:00:00.000Z'),
    },
  ]);
  const tool = buildPiConversationHistoryTool({
    service: { search } as never,
    workingDirectory: '/workspace/alpha',
  }) as {
    name: string;
    execute: (id: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };

  expect(tool.name).toBe(CONVERSATION_HISTORY_TOOL_NAME);
  await expect(tool.execute('call-1', { query: 'SQLite', limit: 3 })).resolves.toMatchObject({
    details: { count: 1 },
  });
  expect(search).toHaveBeenCalledWith({
    workingDirectory: '/workspace/alpha',
    query: 'SQLite',
    limit: 3,
  });
});
