import Database from 'better-sqlite3';
import { createServer } from 'node:http';
import { expect, test, vi } from 'vitest';
import { ActivityService } from '../main/activity/activityService';
import { initializeActivitySchema } from '../main/activity/schema';
import { ActivityRetention, ActivityStatus } from '../shared/activity/constants';

import {
  DeliveryMode,
  DeliveryStatus,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  TaskStatus,
  WakeMode,
} from './constants';
import { CcConnectDeliveryClient } from './ccConnectDeliveryClient';
import { CcConnectDeliveryTransport } from './ccConnectDeliveryTransport';
import { ScheduledTaskDeliveryDispatcher } from './deliveryDispatcher';
import { SchedulerRuntime } from './schedulerRuntime';
import { initializeScheduledTaskSchema } from './schema';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

function setup() {
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  const store = new SqliteScheduledTaskStore(db);
  const task = store.create({
    name: 'task',
    description: '',
    enabled: true,
    schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: PayloadKind.AgentTurn, message: 'run' },
    delivery: { mode: DeliveryMode.None },
    workspaceId: 'workspace-1',
  });
  const clock = { upsert: vi.fn(), remove: vi.fn(), stop: vi.fn() };
  const execute = vi.fn(async () => ({ sessionId: 'pi-run' }));
  return {
    db,
    store,
    task,
    clock,
    execute,
    runtime: new SchedulerRuntime(store, clock, execute),
  };
}

test('projects only schedules and executes a claimed trigger once', async () => {
  const { store, task, clock, execute, runtime } = setup();
  await runtime.register(task);
  expect(clock.upsert).toHaveBeenCalledWith({
    taskId: task.id,
    scheduleVersion: task.scheduleVersion,
    schedule: task.schedule,
  });
  const trigger = {
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  };
  await runtime.handleTrigger(trigger);
  await runtime.handleTrigger(trigger);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(store.listRuns(task.id)[0]).toMatchObject({ status: 'success', sessionId: 'pi-run' });
});

test('publishes Cron activity from the canonical run and keeps the answer preview', async () => {
  const { db, store, task, clock } = setup();
  const result = Promise.withResolvers<{ sessionId: string; output: string }>();
  initializeActivitySchema(db);
  const activity = new ActivityService(db);
  const runtime = new SchedulerRuntime(store, clock, () => result.promise, undefined, activity);
  try {
    const pending = runtime.runNow(task.id);
    const [running] = activity.list();
    expect(running).toMatchObject({ status: ActivityStatus.Running, taskName: task.name });

    result.resolve({ sessionId: 'pi-run', output: 'Report generated' });
    await pending;
    const [finished] = store.listRuns(task.id);
    expect(activity.list()).toMatchObject([
      {
        id: running.id,
        status: ActivityStatus.Completed,
        sessionId: 'pi-run',
        replyPreview: 'Report generated',
        updatedAt: Date.parse(finished.finishedAt!),
      },
    ]);
    expect(
      db.prepare('SELECT status FROM zhiyuan_activity_runs WHERE id = ?').get(running.id),
    ).toBeUndefined();
    expect(
      db
        .prepare('SELECT task_name, reply_preview FROM zhiyuan_scheduled_task_runs WHERE id = ?')
        .get(running.id),
    ).toEqual({ task_name: task.name, reply_preview: 'Report generated' });
  } finally {
    result.resolve({ sessionId: 'pi-run', output: 'Report generated' });
    await runtime.stop();
    db.close();
  }
});

test('failed Cron settlement advances activity order and retention without an activity row', async () => {
  const { db, store, task, clock } = setup();
  const result = Promise.withResolvers<never>();
  initializeActivitySchema(db);
  const activity = new ActivityService(db);
  const runtime = new SchedulerRuntime(store, clock, () => result.promise, undefined, activity);
  const pending = expect(runtime.runNow(task.id)).rejects.toThrow('fixture failure');
  try {
    const [running] = activity.list();
    expect(running).toMatchObject({ status: ActivityStatus.Running, taskName: task.name });
    const start = '2026-08-11T06:00:00.123Z';
    db.prepare('UPDATE zhiyuan_scheduled_task_runs SET started_at = ? WHERE id = ?').run(
      start,
      running.id,
    );
    db.exec(`CREATE TRIGGER reject_snapshot_rewrite BEFORE UPDATE ON zhiyuan_activity_runs
      BEGIN SELECT RAISE(ABORT, 'unexpected activity snapshot write'); END`);

    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      result.reject(new Error('fixture failure'));
      await pending;
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
    const [finished] = store.listRuns(task.id);
    const finishedAt = Date.parse(finished.finishedAt!);
    activity.recordChannelRun({
      id: 'channel',
      status: ActivityStatus.Completed,
      updatedAt: finishedAt - 1,
    });
    expect(activity.list()).toMatchObject([
      {
        id: running.id,
        status: ActivityStatus.Failed,
        errorMessage: 'fixture failure',
        updatedAt: finishedAt,
      },
      { id: 'channel', updatedAt: finishedAt - 1 },
    ]);
    expect(activity.pruneExpired(finishedAt + ActivityRetention.Milliseconds)).toBe(1);
    expect(
      activity.list(100, finishedAt + ActivityRetention.Milliseconds).map(run => run.id),
    ).toEqual([running.id]);
    expect(activity.pruneExpired(finishedAt + ActivityRetention.Milliseconds + 1)).toBe(0);
    expect(activity.list(100, finishedAt + ActivityRetention.Milliseconds + 1)).toEqual([]);
  } finally {
    result.reject(new Error('fixture failure'));
    await runtime.stop();
    db.close();
  }
});

test('normalizes equivalent scheduledAt offsets before claiming a Run', async () => {
  const { store, task, execute, runtime } = setup();
  await runtime.handleTrigger({
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: '2026-08-11T14:00:00+08:00',
  });
  await runtime.handleTrigger({
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  });
  expect(execute).toHaveBeenCalledOnce();
  expect(store.listRuns(task.id)).toHaveLength(1);
});

test('shutdown refuses new claims and waits for an existing run to persist its result', async () => {
  const { store, task, clock } = setup();
  const result = Promise.withResolvers<{ sessionId: string }>();
  const execute = vi.fn((_task, _run, signal: AbortSignal) => {
    expect(signal.aborted).toBe(false);
    return result.promise;
  });
  const runtime = new SchedulerRuntime(store, clock, execute);
  const run = runtime.runNow(task.id);
  const drained = vi.fn();
  const stopping = runtime.stop().then(drained);
  expect(clock.stop).toHaveBeenCalledOnce();
  await expect(runtime.runNow(task.id)).rejects.toThrow();
  await runtime.handleTrigger({
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  });
  expect(drained).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0][2].aborted).toBe(true);
  result.resolve({ sessionId: 'pi-run' });
  await Promise.all([run, stopping]);
  expect(store.listRuns(task.id)).toMatchObject([{ status: TaskStatus.Success }]);
});

test('shutdown aborts a pending channel confirmation and persists the delivery outcome', async () => {
  const { db, store, task, clock } = setup();
  store.update(task.id, {
    delivery: { mode: DeliveryMode.Announce, channel: 'weixin', accountId: 'bot', to: 'chat' },
  });
  const requestReceived = Promise.withResolvers<void>();
  const requestClosed = vi.fn();
  const server = createServer((request, response) => {
    response.once('close', requestClosed);
    request.resume();
    request.once('end', requestReceived.resolve);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const transport = new CcConnectDeliveryTransport({
    getCcConnectSessionKey: () => 'weixin:chat',
    getCcConnectCoworkSessionId: () => null,
  });
  transport.connect(['bot'], new CcConnectDeliveryClient(`http://127.0.0.1:${port}`, 'fixture'));
  const runtime = new SchedulerRuntime(
    store,
    clock,
    async () => ({ sessionId: 'pi-run', output: 'Report generated' }),
    new ScheduledTaskDeliveryDispatcher(store, transport),
  );
  const run = runtime.runNow(task.id);
  try {
    await requestReceived.promise;
    const [completed] = store.listRuns(task.id);
    expect(completed.status).toBe(TaskStatus.Success);
    expect(store.listDeliveries(completed.id)).toMatchObject([{ status: DeliveryStatus.Pending }]);

    const drained = vi.fn();
    const stop = runtime.stop().then(drained);
    await vi.waitFor(() => expect(drained).toHaveBeenCalledOnce());
    await Promise.all([stop, run]);
    await vi.waitFor(() => expect(requestClosed).toHaveBeenCalledOnce());
    expect(store.listRuns(task.id)).toEqual([completed]);
    expect(store.listDeliveries(completed.id)).toMatchObject([
      {
        status: DeliveryStatus.Error,
        error: 'Delivery confirmation interrupted by application shutdown',
        deliveredAt: null,
        receiptId: null,
      },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await Promise.allSettled([run, runtime.stop()]);
    db.close();
  }
});

test('ignores triggers from a stale schedule version', async () => {
  const { store, task, execute, runtime } = setup();
  const updated = store.update(task.id, {
    schedule: { kind: ScheduleKind.Every, everyMs: 120_000 },
  });

  await runtime.handleTrigger({
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  });

  expect(updated.scheduleVersion).not.toBe(task.scheduleVersion);
  expect(execute).not.toHaveBeenCalled();
  expect(store.listRuns(task.id)).toHaveLength(0);
});

test('rebuilds the complete trigger projection from canonical SQLite tasks', async () => {
  const { store, task, clock, runtime } = setup();
  const disabled = store.update(task.id, { enabled: false });
  const second = store.create({
    name: 'second',
    description: '',
    enabled: true,
    schedule: { kind: ScheduleKind.Every, everyMs: 120_000 },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: PayloadKind.AgentTurn, message: 'run' },
    delivery: { mode: DeliveryMode.None },
    workspaceId: 'workspace-1',
  });
  await runtime.reconcile([disabled, second]);
  expect(clock.remove).toHaveBeenCalledWith(disabled.id);
  expect(clock.upsert).toHaveBeenCalledWith({
    taskId: second.id,
    scheduleVersion: second.scheduleVersion,
    schedule: second.schedule,
  });
});

test('disabled tasks delete their sidecar projection and never execute', async () => {
  const { store, task, clock, execute, runtime } = setup();
  const disabled = store.update(task.id, { enabled: false });
  await runtime.register(disabled);
  expect(clock.remove).toHaveBeenCalledWith(task.id);
  await runtime.handleTrigger({
    taskId: task.id,
    scheduleVersion: disabled.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  });
  expect(execute).not.toHaveBeenCalled();
});

test('ignores a trigger for an unknown task before it claims a Run', async () => {
  const { store, task, execute, runtime } = setup();
  await runtime.handleTrigger({
    taskId: 'missing-task',
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  });
  expect(execute).not.toHaveBeenCalled();
  expect(store.listRuns(task.id)).toHaveLength(0);
});

test('uses the scheduler clock for a task delivered through a non-default channel account', async () => {
  const { store, task, clock, execute, runtime } = setup();
  const routed = store.update(task.id, {
    delivery: {
      mode: DeliveryMode.Announce,
      channel: 'telegram',
      accountId: 'telegram-work',
      to: '42',
    },
  });
  await runtime.register(routed);
  expect(clock.upsert).toHaveBeenCalledWith({
    taskId: routed.id,
    scheduleVersion: routed.scheduleVersion,
    schedule: routed.schedule,
  });
  await runtime.handleTrigger({
    taskId: routed.id,
    scheduleVersion: routed.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  });
  expect(execute).toHaveBeenCalledOnce();
});

test('persists delivery separately after Pi completes without changing Run success', async () => {
  const { store, task, clock } = setup();
  const dispatch = vi.fn(async () => {
    throw new Error('sidecar offline');
  });
  const runtime = new SchedulerRuntime(
    store,
    clock,
    async () => ({ sessionId: 'pi-run', output: 'done' }),
    { dispatch } as never,
  );
  await runtime.runNow(task.id);
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ id: task.id }),
    expect.objectContaining({ status: 'success' }),
    'done',
    expect.any(AbortSignal),
  );
  expect(store.listRuns(task.id)[0]).toMatchObject({ status: 'success' });
});

test('finishes a claimed Run as error when Pi terminates unexpectedly', async () => {
  const { store, task, clock } = setup();
  const runtime = new SchedulerRuntime(store, clock, async () => {
    throw new Error('Pi session stopped before completion');
  });

  await expect(runtime.runNow(task.id)).rejects.toThrow('Pi session stopped before completion');
  expect(store.get(task.id)?.state).toMatchObject({
    runningAtMs: null,
    lastStatus: TaskStatus.Error,
    lastError: 'Pi session stopped before completion',
  });
  expect(store.listRuns(task.id)[0]).toMatchObject({
    status: TaskStatus.Error,
    error: 'Pi session stopped before completion',
  });
});

test('publishes each Run transition together with the task state it produced', async () => {
  const { store, task, clock } = setup();
  const events = { runUpdated: vi.fn(), taskStateChanged: vi.fn() };
  const runtime = new SchedulerRuntime(
    store,
    clock,
    async () => ({ sessionId: 'pi-run' }),
    undefined,
    undefined,
    events,
  );

  await runtime.runNow(task.id);

  expect(events.runUpdated).toHaveBeenCalledTimes(2);
  expect(events.runUpdated.mock.calls[0][0]).toMatchObject({ status: TaskStatus.Running });
  expect(events.runUpdated.mock.calls[1][0]).toMatchObject({ status: TaskStatus.Success });
  expect(events.runUpdated.mock.calls[0][1]).toBe(task.name);
  expect(events.taskStateChanged).toHaveBeenLastCalledWith(
    task.id,
    expect.objectContaining({ runningAtMs: null, lastStatus: TaskStatus.Success }),
  );
});
