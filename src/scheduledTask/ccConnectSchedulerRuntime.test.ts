import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { DeliveryMode, PayloadKind, ScheduleKind, SessionTarget, TaskStatus, WakeMode } from './constants';
import { CcConnectSchedulerRuntime } from './ccConnectSchedulerRuntime';
import { SchedulerClockAccount } from './ccConnectCronClient';
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
  expect(client.upsert).toHaveBeenCalledWith({ accountId: SchedulerClockAccount, taskId: task.id, scheduleVersion: task.scheduleVersion, schedule: task.schedule });
  const trigger = { accountId: SchedulerClockAccount, taskId: task.id, scheduleVersion: task.scheduleVersion!, scheduledAt: '2026-08-11T06:00:00.000Z' };
  await runtime.handleTrigger(trigger);
  await runtime.handleTrigger(trigger);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(store.listRuns(task.id)[0]).toMatchObject({ status: 'success', sessionId: 'pi-run' });
});

test('normalizes equivalent scheduledAt offsets before claiming a Run', async () => {
  const { store, task, execute, runtime } = setup();
  await runtime.handleTrigger({ accountId: SchedulerClockAccount, taskId: task.id, scheduleVersion: task.scheduleVersion!, scheduledAt: '2026-08-11T14:00:00+08:00' });
  await runtime.handleTrigger({ accountId: SchedulerClockAccount, taskId: task.id, scheduleVersion: task.scheduleVersion!, scheduledAt: '2026-08-11T06:00:00.000Z' });
  expect(execute).toHaveBeenCalledOnce();
  expect(store.listRuns(task.id)).toHaveLength(1);
});

test('rebuilds the complete trigger projection from canonical SQLite tasks', async () => {
  const { store, task, client, runtime } = setup();
  const disabled = store.update(task.id, { enabled: false });
  const second = store.create({ name: 'second', description: '', enabled: true,
    schedule: { kind: ScheduleKind.Every, everyMs: 120_000 }, sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat, payload: { kind: PayloadKind.AgentTurn, message: 'run' },
    delivery: { mode: DeliveryMode.None }, agentId: 'main' });
  await runtime.reconcile([disabled, second]);
  expect(client.remove).toHaveBeenCalledWith({ taskId: disabled.id });
  expect(client.upsert).toHaveBeenCalledWith({ accountId: SchedulerClockAccount, taskId: second.id, scheduleVersion: second.scheduleVersion, schedule: second.schedule });
});

test('disabled tasks delete their sidecar projection and never execute', async () => {
  const { store, task, client, execute, runtime } = setup();
  const disabled = store.update(task.id, { enabled: false });
  await runtime.register(disabled);
  expect(client.remove).toHaveBeenCalledWith({ taskId: task.id });
  await runtime.handleTrigger({ accountId: SchedulerClockAccount, taskId: task.id, scheduleVersion: disabled.scheduleVersion!, scheduledAt: '2026-08-11T06:00:00.000Z' });
  expect(execute).not.toHaveBeenCalled();
});

test('rejects a trigger that did not originate from the scheduler clock before it claims a Run', async () => {
  const { store, task, execute, runtime } = setup();
  await runtime.handleTrigger({ accountId: 'other-account', taskId: task.id, scheduleVersion: task.scheduleVersion!, scheduledAt: '2026-08-11T06:00:00.000Z' });
  expect(execute).not.toHaveBeenCalled();
  expect(store.listRuns(task.id)).toHaveLength(0);
});

test('uses the scheduler clock for a task delivered through a non-default channel account', async () => {
  const { store, task, client, execute, runtime } = setup();
  const routed = store.update(task.id, { delivery: { mode: DeliveryMode.Announce, channel: 'telegram', accountId: 'telegram-work', to: '42' } });
  await runtime.register(routed);
  expect(client.upsert).toHaveBeenCalledWith({ accountId: SchedulerClockAccount, taskId: routed.id, scheduleVersion: routed.scheduleVersion, schedule: routed.schedule });
  await runtime.handleTrigger({ accountId: SchedulerClockAccount, taskId: routed.id, scheduleVersion: routed.scheduleVersion!, scheduledAt: '2026-08-11T06:00:00.000Z' });
  expect(execute).toHaveBeenCalledOnce();
});

test('persists delivery separately after Pi completes without changing Run success', async () => {
  const { store, task, client } = setup();
  const dispatch = vi.fn(async () => { throw new Error('sidecar offline'); });
  const runtime = new CcConnectSchedulerRuntime(store, client, async () => ({ sessionId: 'pi-run', output: 'done' }), { dispatch } as never);
  await runtime.runNow(task.id);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: task.id }), expect.objectContaining({ status: 'success' }), 'done');
  expect(store.listRuns(task.id)[0]).toMatchObject({ status: 'success' });
});

test('finishes a claimed Run as error when Pi terminates unexpectedly', async () => {
  const { store, task, client } = setup();
  const runtime = new CcConnectSchedulerRuntime(store, client, async () => {
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
