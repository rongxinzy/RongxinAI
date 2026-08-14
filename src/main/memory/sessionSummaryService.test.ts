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

test('reduces markdown-heavy outcomes to one bounded conclusion sentence', () => {
  const summary = buildSessionSummary([
    message('user', 'Fix session memory isolation.'),
    message(
      'assistant',
      [
        '## Result',
        '| Session | Secret |',
        '| --- | --- |',
        '| other | private table data |',
        '**Fixed session isolation.** Additional implementation details should not be copied.',
        '```ts',
        'const privateData = true;',
        '```',
      ].join('\n'),
    ),
  ]);

  expect(summary).toContain('Latest outcome: Fixed session isolation.');
  expect(summary).not.toContain('private table data');
  expect(summary).not.toContain('Additional implementation details');
  expect(summary).not.toContain('privateData');
});

test('ends Chinese outcomes at punctuation without requiring whitespace', () => {
  const summary = buildSessionSummary([
    message('user', '修复会话记忆隔离。'),
    message('assistant', '已完成会话隔离。后续实现细节不应进入摘要。'),
  ]);

  expect(summary).toContain('Latest outcome: 已完成会话隔离。');
  expect(summary).not.toContain('后续实现细节');
});

test('keeps heading text and skips summaries with no natural-language outcome', () => {
  expect(
    buildSessionSummary([
      message('user', 'Fix recall.'),
      message('assistant', '## Isolation fixed.\n| Key | Value |\n| --- | --- |'),
    ]),
  ).toContain('Latest outcome: Isolation fixed.');
  expect(
    buildSessionSummary([
      message('user', 'Run code.'),
      message('assistant', '```ts\nconst result = true;\n```'),
    ]),
  ).toBeNull();
});
