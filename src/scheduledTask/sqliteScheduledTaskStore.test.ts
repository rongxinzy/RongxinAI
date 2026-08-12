import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { DeliveryMode, PayloadKind, ScheduleKind, SessionTarget, TaskStatus, WakeMode } from './constants';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

function createTask(store: SqliteScheduledTaskStore) {
  return store.create({ name: '提醒', description: '', enabled: true,
    schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *', tz: 'Asia/Shanghai' },
    sessionTarget: SessionTarget.Isolated, wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: PayloadKind.AgentTurn, message: 'hello' }, delivery: { mode: DeliveryMode.None }, agentId: 'main' });
}

test('SQLite is the canonical task source and changes schedule version on projection changes', () => {
  const store = new SqliteScheduledTaskStore(new Database(':memory:'));
  const task = createTask(store);
  expect(store.list()).toEqual([task]);
  const updated = store.update(task.id, { enabled: false });
  expect(updated.scheduleVersion).not.toBe(task.scheduleVersion);
  expect(store.get(task.id)?.enabled).toBe(false);
});

test('claims each scheduled trigger once and persists its completed Run', () => {
  const store = new SqliteScheduledTaskStore(new Database(':memory:'));
  const task = createTask(store);
  const trigger = { taskId: task.id, scheduleVersion: task.scheduleVersion!, scheduledAt: '2026-08-11T06:00:00.000Z' };
  const run = store.claimTrigger(trigger);
  expect(run?.status).toBe('running');
  expect(store.claimTrigger(trigger)).toBeNull();
  const complete = store.finishRun(run!.id, { status: TaskStatus.Success, sessionId: 'pi-session' });
  expect(complete).toMatchObject({ status: 'success', sessionId: 'pi-session' });
  expect(store.listRuns(task.id)).toHaveLength(1);
});

test('persists Delivery attempts beside the canonical Run', () => {
  const store = new SqliteScheduledTaskStore(new Database(':memory:'));
  const task = createTask(store);
  const run = store.claimTrigger({ taskId: task.id, scheduleVersion: task.scheduleVersion!, scheduledAt: '2026-08-11T06:00:00.000Z' })!;
  const delivery = store.createDelivery({
    runId: run.id, taskId: task.id, mode: DeliveryMode.Announce,
    channel: 'telegram', to: '42', accountId: 'telegram-work', status: 'success',
    deliveredAt: '2026-08-11T06:00:01.000Z', receiptId: 'delivery-42', error: null,
  });
  expect(store.listDeliveries(run.id)).toEqual([delivery]);
  store.remove(task.id);
  expect(store.listDeliveries(run.id)).toEqual([]);
});

test('keeps a legacy id stable when importing canonical task records', () => {
  const store = new SqliteScheduledTaskStore(new Database(':memory:'));
  const input = { name: 'legacy', description: '', enabled: false,
    schedule: { kind: ScheduleKind.At, at: '2020-01-01T00:00:00.000Z' },
    sessionTarget: SessionTarget.Isolated, wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: PayloadKind.AgentTurn, message: 'saved' }, delivery: { mode: DeliveryMode.None }, agentId: 'main' } as const;
  expect(store.importLegacy('legacy-id', input).id).toBe('legacy-id');
  expect(store.importLegacy('legacy-id', { ...input, name: 'ignored' }).name).toBe('legacy');
});

test('recovers interrupted running Runs as visible errors', () => {
  const store = new SqliteScheduledTaskStore(new Database(':memory:'));
  const task = createTask(store);
  const run = store.claimTrigger({ taskId: task.id, scheduleVersion: task.scheduleVersion!, scheduledAt: '2026-08-11T06:00:00.000Z' })!;
  expect(store.recoverInterruptedRuns()).toBe(1);
  expect(store.listRuns(task.id)[0]).toMatchObject({ id: run.id, status: 'error', error: 'Scheduler interrupted before Pi completion' });
  expect(store.get(task.id)?.state.runningAtMs).toBeNull();
});
