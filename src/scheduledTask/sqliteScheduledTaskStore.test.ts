import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import {
  DeliveryMode,
  DeliveryStatus,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  TaskStatus,
  WakeMode,
} from './constants';
import { initializeScheduledTaskSchema } from './schema';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

function createTask(store: SqliteScheduledTaskStore) {
  return store.create({
    name: '提醒',
    description: '',
    enabled: true,
    schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *', tz: 'Asia/Shanghai' },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: PayloadKind.AgentTurn, message: 'hello' },
    delivery: { mode: DeliveryMode.None },
    workspaceId: 'workspace-1',
  });
}

test('SQLite is the canonical task source and changes schedule version on projection changes', () => {
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  const store = new SqliteScheduledTaskStore(db);
  const task = createTask(store);
  expect(store.list()).toEqual([task]);
  const updated = store.update(task.id, { enabled: false });
  expect(updated.scheduleVersion).not.toBe(task.scheduleVersion);
  expect(store.get(task.id)?.enabled).toBe(false);
});

test('pages both run history views after applying status and inclusive local date filters', () => {
  const db = new Database(':memory:');
  try {
    initializeScheduledTaskSchema(db);
    const store = new SqliteScheduledTaskStore(db);
    const first = createTask(store);
    const second = createTask(store);
    store.update(second.id, { name: 'Second task' });
    const midnight = Date.parse('2026-11-22T00:00:00');
    const endOfDay = Date.parse('2026-11-22T23:59:59.999');
    const importRun = (id: string, taskId: string, time: number, status: TaskStatus) => {
      const timestamp = new Date(time).toISOString();
      store.importLegacyRun({
        id,
        taskId,
        sessionId: null,
        sessionKey: null,
        status,
        startedAt: timestamp,
        finishedAt: timestamp,
        durationMs: 0,
        error: null,
      });
    };
    importRun('previous-day', first.id, midnight - 1, TaskStatus.Success);
    importRun('first-in-day', first.id, midnight, TaskStatus.Success);
    importRun('last-in-day', first.id, endOfDay, TaskStatus.Success);
    importRun('other-task', second.id, endOfDay - 1, TaskStatus.Success);
    importRun('error', second.id, endOfDay, TaskStatus.Error);
    importRun('next-day', first.id, endOfDay + 1, TaskStatus.Success);
    const filter = { startDate: '2026-11-22', endDate: '2026-11-22', status: TaskStatus.Success };

    expect(store.listRuns(first.id, 20, 0, filter).map(run => run.id)).toEqual([
      'last-in-day',
      'first-in-day',
    ]);
    expect(store.listRuns(first.id, 1, 1, filter).map(run => run.id)).toEqual(['first-in-day']);
    expect(store.listRuns(first.id, 1, -2, filter).map(run => run.id)).toEqual(['last-in-day']);
    expect(store.listRunsWithName(1, 1, filter)).toMatchObject([
      { id: 'other-task', taskName: 'Second task' },
    ]);
    store.remove(second.id);
    expect(store.listRunsWithName(1, 1, filter)).toMatchObject([{ id: 'first-in-day' }]);
    expect(store.listRuns(second.id, 1, 0, filter)).toMatchObject([{ id: 'other-task' }]);
  } finally {
    db.close();
  }
});

test('claims each scheduled trigger once and persists its completed Run', () => {
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  const store = new SqliteScheduledTaskStore(db);
  const task = createTask(store);
  const trigger = {
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  };
  const run = store.claimTrigger(trigger);
  expect(run?.status).toBe('running');
  expect(store.claimTrigger(trigger)).toBeNull();
  const complete = store.finishRun(run!.id, {
    status: TaskStatus.Success,
    sessionId: 'pi-session',
  });
  expect(complete).toMatchObject({ status: 'success', sessionId: 'pi-session' });
  expect(store.listRuns(task.id)).toHaveLength(1);
});

test('lets a manual invocation run a paused task exactly once', () => {
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  const store = new SqliteScheduledTaskStore(db);
  const task = createTask(store);
  const paused = store.update(task.id, { enabled: false });
  const trigger = {
    taskId: task.id,
    scheduleVersion: paused.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  };

  expect(store.claimTrigger(trigger)).toBeNull();
  expect(store.claimTrigger(trigger, { allowDisabled: true })?.status).toBe(TaskStatus.Running);
  expect(store.claimTrigger(trigger, { allowDisabled: true })).toBeNull();
});

test('persists Delivery attempts beside the canonical Run', () => {
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  const store = new SqliteScheduledTaskStore(db);
  const task = createTask(store);
  const run = store.claimTrigger({
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  })!;
  const delivery = store.createDelivery({
    runId: run.id,
    taskId: task.id,
    mode: DeliveryMode.Announce,
    channel: 'telegram',
    to: '42',
    accountId: 'telegram-work',
    status: DeliveryStatus.Success,
    deliveredAt: '2026-08-11T06:00:01.000Z',
    receiptId: 'delivery-42',
    error: null,
  });
  expect(store.listDeliveries(run.id)).toEqual([delivery]);
  store.remove(task.id);
  expect(store.listDeliveries(run.id)).toEqual([delivery]);
});

test('keeps a legacy id stable when importing canonical task records', () => {
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  const store = new SqliteScheduledTaskStore(db);
  const input = {
    name: 'legacy',
    description: '',
    enabled: false,
    schedule: { kind: ScheduleKind.At, at: '2020-01-01T00:00:00.000Z' },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: PayloadKind.AgentTurn, message: 'saved' },
    delivery: { mode: DeliveryMode.None },
    workspaceId: 'workspace-1',
  } as const;
  expect(store.importLegacy('legacy-id', input).id).toBe('legacy-id');
  expect(store.importLegacy('legacy-id', { ...input, name: 'ignored' }).name).toBe('legacy');
});

test('Cron claims, completion and restart recovery need only write Run records', () => {
  const db = new Database(':memory:');
  try {
    initializeScheduledTaskSchema(db);
    const store = new SqliteScheduledTaskStore(db);
    const task = createTask(store);
    const trigger = {
      taskId: task.id,
      scheduleVersion: task.scheduleVersion!,
      scheduledAt: '2026-08-11T06:00:00.000Z',
    };
    db.exec(`CREATE TRIGGER fixture_block_state BEFORE UPDATE ON zhiyuan_scheduled_tasks
      BEGIN SELECT RAISE(ABORT, 'fixture task state failure'); END;`);

    const first = store.claimTrigger(trigger)!;
    const second = store.claimTrigger({ ...trigger, scheduledAt: '2026-08-12T06:00:00.000Z' })!;
    const completed = store.finishRun(first.id, { status: TaskStatus.Success });
    expect(store.get(task.id)?.state).toMatchObject({
      runningAtMs: Date.parse(second.startedAt),
      lastStatus: TaskStatus.Success,
      lastRunAtMs: Date.parse(completed.finishedAt!),
    });
    expect(store.recoverInterruptedRuns()).toBe(1);
    expect(store.list()[0].state).toMatchObject({
      runningAtMs: null,
      lastStatus: TaskStatus.Error,
      consecutiveErrors: 1,
    });
  } finally {
    db.close();
  }
});

test('recovers interrupted running Runs as visible errors', () => {
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  const store = new SqliteScheduledTaskStore(db);
  const task = createTask(store);
  const run = store.claimTrigger({
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  })!;
  expect(store.recoverInterruptedRuns()).toBe(1);
  expect(store.listRuns(task.id)[0]).toMatchObject({
    id: run.id,
    status: 'error',
    error: 'Scheduler interrupted before Pi completion',
  });
  expect(store.get(task.id)?.state.runningAtMs).toBeNull();
});

test('projects the latest outcome and error streak from historical runs', () => {
  const db = new Database(':memory:');
  try {
    initializeScheduledTaskSchema(db);
    const store = new SqliteScheduledTaskStore(db);
    const task = createTask(store);
    db.prepare('UPDATE zhiyuan_scheduled_tasks SET state_json = ? WHERE id = ?').run(
      '{retired snapshot',
      task.id,
    );
    const record = (minute: number, status: TaskStatus) => {
      const startedAt = `2026-08-11T06:0${minute}:00.000Z`;
      const finishedAt = `2026-08-11T06:0${minute}:01.000Z`;
      const error = status === TaskStatus.Error ? `failure ${minute}` : null;
      store.importLegacyRun({
        id: `run-${minute}`,
        taskId: task.id,
        sessionId: null,
        sessionKey: null,
        status,
        startedAt,
        finishedAt,
        durationMs: 1000,
        error,
      });
      return { finishedAt, error };
    };
    record(4, TaskStatus.Error);
    record(2, TaskStatus.Skipped);
    record(1, TaskStatus.Error);
    const latest = record(5, TaskStatus.Error);
    expect(store.get(task.id)?.state).toMatchObject({
      lastStatus: TaskStatus.Error,
      lastError: latest.error,
      lastRunAtMs: Date.parse(latest.finishedAt),
      lastDurationMs: 1000,
      consecutiveErrors: 2,
    });
    record(6, TaskStatus.Success);
    expect(store.update(task.id, { name: 'renamed' }).state).toMatchObject({
      lastStatus: TaskStatus.Success,
      lastError: null,
      consecutiveErrors: 0,
    });
    expect(
      db.prepare('SELECT state_json FROM zhiyuan_scheduled_tasks WHERE id = ?').get(task.id),
    ).toEqual({ state_json: '{retired snapshot' });
  } finally {
    db.close();
  }
});
