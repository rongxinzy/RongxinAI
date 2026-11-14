import { expect, test, vi } from 'vitest';
import { buildPiScheduledTaskTool } from './piScheduledTaskTool';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import type { ScheduledTaskInput } from '../../../scheduledTask/types';

function fixture() {
  const inputs: ScheduledTaskInput[] = [];
  const addJob = vi.fn(async (input: ScheduledTaskInput) => {
    inputs.push(input);
    return { id: 'task-1', name: input.name };
  });
  const tool = buildPiScheduledTaskTool({
    service: { addJob } as unknown as ScheduledTaskService,
    workspaceId: 'workspace',
  });
  const execute = tool.execute as (
    call: string,
    params: Record<string, unknown>,
  ) => Promise<{ details: Record<string, unknown> }>;
  return { inputs, execute, addJob, tool };
}
const params = { name: 'Task', schedule: { kind: 'every', everyMs: 60000 }, message: 'Run.' };

test('creates a local task conversation in the selected workspace', async () => {
  const f = fixture();
  expect((await f.execute('call', params)).details).toEqual({ taskId: 'task-1' });
  expect(f.inputs[0]).toMatchObject({
    workspaceId: 'workspace',
    sessionTarget: 'isolated',
    sessionKey: null,
    delivery: { mode: 'none' },
    payload: { kind: 'agentTurn', message: 'Run.' },
  });
  expect(JSON.stringify(f.tool.parameters)).not.toContain('delivery');
});

test('invalid intervals and past one-time timestamps are reported without creating a job', async () => {
  const f = fixture();
  expect(
    (await f.execute('call', { ...params, schedule: { kind: 'every', everyMs: 0 } })).details
      .isError,
  ).toBe(true);
  expect(
    (await f.execute('call', { ...params, schedule: { kind: 'at', at: '2000-01-01T00:00:00Z' } }))
      .details.isError,
  ).toBe(true);
  expect(f.addJob).not.toHaveBeenCalled();
});

test('service failures remain visible to the agent', async () => {
  const f = fixture();
  f.addJob.mockRejectedValueOnce(new Error('Native storage is unavailable.'));
  const result = await f.execute('call', params);
  expect(result.details.isError).toBe(true);
});

test('cron timezone and stagger reach native scheduling without being discarded', async () => {
  const f = fixture();
  await f.execute('call', {
    ...params,
    schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai', staggerMs: 3000 },
  });
  expect(f.inputs[0].schedule).toEqual({
    kind: 'cron',
    expr: '0 9 * * *',
    tz: 'Asia/Shanghai',
    staggerMs: 3000,
  });
});
