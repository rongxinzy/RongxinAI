import { expect, test } from 'vitest';

import { ChannelRunStatus, ChannelRunTrigger } from './constants';
import { buildChannelRunSummary } from './summary';

const baseInput = {
  sessionId: 'session-1',
  platform: 'feishu',
  conversationId: 'conv-1',
  trigger: ChannelRunTrigger.Channel,
};

test('builds a started summary with a collapsed input preview', () => {
  const summary = buildChannelRunSummary({
    ...baseInput,
    status: ChannelRunStatus.Started,
    input: '  hello\n\nworld   this is a message  ',
  });

  expect(summary.status).toBe(ChannelRunStatus.Started);
  expect(summary.inputPreview).toBe('hello world this is a message');
  expect(summary.replyPreview).toBeUndefined();
  expect(summary.errorMessage).toBeUndefined();
  expect(summary.timestamp).toBeGreaterThan(0);
});

test('truncates long previews at 80 characters with an ellipsis', () => {
  const summary = buildChannelRunSummary({
    ...baseInput,
    status: ChannelRunStatus.Completed,
    reply: 'x'.repeat(200),
  });

  expect(summary.replyPreview).toHaveLength(81);
  expect(summary.replyPreview?.endsWith('…')).toBe(true);
});

test('omits previews for empty or whitespace-only text', () => {
  const summary = buildChannelRunSummary({
    ...baseInput,
    status: ChannelRunStatus.Failed,
    input: '   \n  ',
    error: '处理超时，请稍后重试',
  });

  expect(summary.inputPreview).toBeUndefined();
  expect(summary.errorMessage).toBe('处理超时，请稍后重试');
});

test('keeps trigger and identity fields verbatim', () => {
  const summary = buildChannelRunSummary({
    ...baseInput,
    trigger: ChannelRunTrigger.Cron,
    status: ChannelRunStatus.Completed,
    reply: 'done',
  });

  expect(summary.trigger).toBe(ChannelRunTrigger.Cron);
  expect(summary.sessionId).toBe('session-1');
  expect(summary.platform).toBe('feishu');
  expect(summary.conversationId).toBe('conv-1');
});
