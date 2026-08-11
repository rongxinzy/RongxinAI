import { expect, test, vi } from 'vitest';

import type { CoworkMessage } from '../coworkStore';
import { buildSessionSummary, SessionSummaryService } from './sessionSummaryService';

function message(
  type: CoworkMessage['type'],
  content: string,
  metadata?: CoworkMessage['metadata'],
): CoworkMessage {
  return { id: `${type}-${content}`, type, content, timestamp: 1, metadata };
}

test('builds a bounded summary without thinking or tool output', () => {
  const summary = buildSessionSummary([
    message('user', '检查中文记忆召回'),
    message('assistant', 'hidden chain of thought', { isThinking: true }),
    message('tool_result', 'large private tool output'),
    message('assistant', '已确认需要使用 CJK 分词并保留项目隔离。'),
  ]);

  expect(summary).toContain('Session objective: 检查中文记忆召回');
  expect(summary).toContain('Latest outcome: 已确认需要使用 CJK 分词并保留项目隔离。');
  expect(summary).not.toContain('chain of thought');
  expect(summary).not.toContain('tool output');
});

test('serializes rolling writes for the same session', async () => {
  let releaseFirst: (() => void) | undefined;
  const saveSessionSummary = vi
    .fn()
    .mockImplementationOnce(() => new Promise<number>(resolve => (releaseFirst = () => resolve(1))))
    .mockResolvedValueOnce(2);
  const coworkStore = {
    getSession: vi.fn(() => ({
      messages: [message('user', '目标'), message('assistant', '结果')],
    })),
  };
  const service = new SessionSummaryService({ saveSessionSummary } as never, coworkStore as never);

  const first = service.rollup({ sessionId: 'session-1', workingDirectory: '/workspace' });
  const second = service.rollup({ sessionId: 'session-1', workingDirectory: '/workspace' });
  await vi.waitFor(() => expect(saveSessionSummary).toHaveBeenCalledTimes(1));
  releaseFirst?.();

  await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
  expect(saveSessionSummary).toHaveBeenCalledTimes(2);
});
