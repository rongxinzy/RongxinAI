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
