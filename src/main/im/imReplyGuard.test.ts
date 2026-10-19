import { expect, test } from 'vitest';

import {
  analyzeIMReply,
  FAILED_REMINDER_FAILURE_REPLY,
  UNSCHEDULED_REMINDER_FAILURE_REPLY,
} from './imReplyGuard';

test('guards IM reminder commitment when no cron.add succeeded', () => {
  const analysis = analyzeIMReply([
    {
      id: 'assistant-1',
      type: 'assistant',
      content: '好的，2分钟后会提醒你喝饮料。',
      timestamp: Date.now(),
      metadata: {},
    },
  ]);

  expect(analysis.guardApplied).toBe(true);
  expect(analysis.successfulCronAdds).toBe(0);
  expect(analysis.text).toBe(UNSCHEDULED_REMINDER_FAILURE_REPLY);
});

test('preserves reminder reply when cron.add completed successfully', () => {
  const analysis = analyzeIMReply([
    {
      id: 'tool-use-1',
      type: 'tool_use',
      content: 'Using tool: cron',
      timestamp: Date.now(),
      metadata: {
        toolName: 'cron',
        toolUseId: 'cron-call-1',
        toolInput: { action: 'add' },
      },
    },
    {
      id: 'tool-result-1',
      type: 'tool_result',
      content: '{"id":"job-1"}',
      timestamp: Date.now(),
      metadata: {
        toolUseId: 'cron-call-1',
        toolResult: '{"id":"job-1"}',
        isError: false,
      },
    },
    {
      id: 'assistant-1',
      type: 'assistant',
      content: '好的，2分钟后会提醒你喝饮料。',
      timestamp: Date.now(),
      metadata: {},
    },
  ]);

  expect(analysis.guardApplied).toBe(false);
  expect(analysis.successfulCronAdds).toBe(1);
  expect(analysis.text).toBe('好的，2分钟后会提醒你喝饮料。');
});

test('recognizes the Pi scheduled_task tool as a real task creation', () => {
  const analysis = analyzeIMReply([
    {
      id: 'tool-use-1',
      type: 'tool_use',
      content: 'Using tool: scheduled_task',
      timestamp: Date.now(),
      metadata: {
        toolName: 'scheduled_task',
        toolUseId: 'task-call-1',
        toolInput: { name: '喝水提醒', schedule: { kind: 'at', at: '2027-01-01T00:00:00+08:00' } },
      },
    },
    {
      id: 'tool-result-1',
      type: 'tool_result',
      content: 'Scheduled task created: 喝水提醒',
      timestamp: Date.now(),
      metadata: {
        toolUseId: 'task-call-1',
        toolResult: 'Scheduled task created: 喝水提醒',
        isError: false,
      },
    },
    {
      id: 'assistant-1',
      type: 'assistant',
      content: '好的，已经为你设置好喝水提醒。',
      timestamp: Date.now(),
      metadata: {},
    },
  ]);

  expect(analysis.guardApplied).toBe(false);
  expect(analysis.successfulCronAdds).toBe(1);
  expect(analysis.text).toBe('好的，已经为你设置好喝水提醒。');
});

test('returns explicit failure when cron.add was attempted but failed', () => {
  const analysis = analyzeIMReply([
    {
      id: 'tool-use-1',
      type: 'tool_use',
      content: 'Using tool: cron',
      timestamp: Date.now(),
      metadata: {
        toolName: 'Cron',
        toolUseId: 'cron-call-1',
        toolInput: { action: 'add' },
      },
    },
    {
      id: 'tool-result-1',
      type: 'tool_result',
      content: 'invalid cron.add params',
      timestamp: Date.now(),
      metadata: {
        toolUseId: 'cron-call-1',
        toolResult: 'invalid cron.add params',
        error: 'invalid cron.add params',
        isError: true,
      },
    },
    {
      id: 'assistant-1',
      type: 'assistant',
      content: '定时任务创建成功！到时间后我会自动提醒你。',
      timestamp: Date.now(),
      metadata: {},
    },
  ]);

  expect(analysis.guardApplied).toBe(true);
  expect(analysis.attemptedCronAdds).toBe(1);
  expect(analysis.successfulCronAdds).toBe(0);
  expect(analysis.text).toBe(FAILED_REMINDER_FAILURE_REPLY);
});

test('does not guard normal non-reminder assistant replies', () => {
  const analysis = analyzeIMReply([
    {
      id: 'assistant-1',
      type: 'assistant',
      content: '今天上海多云，气温 18 到 24 度。',
      timestamp: Date.now(),
      metadata: {},
    },
  ]);

  expect(analysis.guardApplied).toBe(false);
  expect(analysis.text).toBe('今天上海多云，气温 18 到 24 度。');
});
