import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { DeliveryMode, PayloadKind, ScheduleKind, SessionTarget, WakeMode } from './constants';
import { CcConnectSchedulerRuntime } from './ccConnectSchedulerRuntime';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

function setup() {
  const store = new SqliteScheduledTaskStore(new Database(':memory:'));
  const task = store.create({ name: 'task', description: '', enabled: true,
    schedule: { kind: ScheduleKind.Every, everyMs: 60_000 }, sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat, payload: { kind: PayloadKind.AgentTurn, message: 'run' },
    delivery: { mode: DeliveryMode.None }, agentId: 'main' });
  const client = { upsert: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
  const execute = vi.fn(async () => ({ sessionId: 'pi-run' }));
  return { store, task, client, execute, runtime: new CcConnectSchedulerRuntime(store, client, execute) };
}

test('projects only schedules and executes a claimed trigger once', async () => {
  const { store, task, client, execute, runtime } = setup();
  await runtime.register(task);
  expect(client.upsert).toHaveBeenCalledWith({ accountId: 'default', taskId: task.id, scheduleVersion: task.scheduleVersion, schedule: task.schedule });
  const trigger = { taskId: task.id, scheduleVersion: task.scheduleVersion!, scheduledAt: '2026-08-11T06:00:00.000Z' };
  await runtime.handleTrigger(trigger);
  await runtime.handleTrigger(trigger);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(store.listRuns(task.id)[0]).toMatchObject({ status: 'success', sessionId: 'pi-run' });
});

test('disabled tasks delete their sidecar projection and never execute', async () => {
  const { store, task, client, execute, runtime } = setup();
  const disabled = store.update(task.id, { enabled: false });
  await runtime.register(disabled);
  expect(client.remove).toHaveBeenCalledWith({ accountId: 'default', taskId: task.id, scheduleVersion: disabled.scheduleVersion, schedule: disabled.schedule });
  await runtime.handleTrigger({ taskId: task.id, scheduleVersion: disabled.scheduleVersion!, scheduledAt: '2026-08-11T06:00:00.000Z' });
  expect(execute).not.toHaveBeenCalled();
});
