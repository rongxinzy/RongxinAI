import { expect, test, vi } from 'vitest';

import { buildPiScheduledTaskTool } from './piScheduledTaskTool';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import type { ScheduledTaskInput } from '../../../scheduledTask/types';

function createService(): { service: ScheduledTaskService; inputs: ScheduledTaskInput[] } {
  const inputs: ScheduledTaskInput[] = [];
  const service = {
    addJob: vi.fn(async (input: ScheduledTaskInput) => {
      inputs.push(input);
      return { id: 'task-1', name: input.name, sessionKey: input.sessionKey ?? null };
    }),
  } as unknown as ScheduledTaskService;
  return { service, inputs };
}

const baseParams = {
  name: '喝水提醒',
  schedule: { kind: 'at', at: '2027-03-15T16:30:00+08:00' },
  message: '提醒喝水',
};

test('uses the session default delivery when the model omits delivery', async () => {
  const { service, inputs } = createService();
  const tool = buildPiScheduledTaskTool({
    service,
    sessionKey: 'session-1',
    defaultDelivery: { mode: 'announce', channel: 'dingtalk', to: 'user-42', accountId: 'acct-1' },
  });

  const result = await tool.execute!('call-1', baseParams);
  expect(result.details).toMatchObject({ taskId: 'task-1' });
  expect(inputs[0].delivery).toEqual({
    mode: 'announce',
    channel: 'dingtalk',
    to: 'user-42',
    accountId: 'acct-1',
  });
});

test('an explicit delivery from the model wins over the session default', async () => {
  const { service, inputs } = createService();
  const tool = buildPiScheduledTaskTool({
    service,
    sessionKey: 'session-1',
    defaultDelivery: { mode: 'announce', channel: 'dingtalk', to: 'user-42' },
  });

  await tool.execute!('call-1', {
    ...baseParams,
    delivery: { mode: 'none' },
  });
  expect(inputs[0].delivery).toEqual({ mode: 'none' });
});

test('without a default or explicit delivery the task stays undelivered', async () => {
  const { service, inputs } = createService();
  const tool = buildPiScheduledTaskTool({ service, sessionKey: 'session-1' });

  await tool.execute!('call-1', baseParams);
  expect(inputs[0].delivery).toEqual({ mode: 'none' });
});
