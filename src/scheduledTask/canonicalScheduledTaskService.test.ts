import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { CanonicalScheduledTaskService } from './canonicalScheduledTaskService';
import {
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  TaskStatus,
  WakeMode,
} from './constants';
import { SchedulerRuntime } from './schedulerRuntime';
import { initializeScheduledTaskSchema } from './schema';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

test('persists canonical task before projecting and exposes renderer operations', async () => {
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  const store = new SqliteScheduledTaskStore(db);
  const client = { upsert: vi.fn(), remove: vi.fn(), stop: vi.fn() };
  const runtime = new SchedulerRuntime(store, client, async () => ({ sessionId: 'pi' }));
  const service = new CanonicalScheduledTaskService(store, runtime);
  const task = await service.addJob({
    name: 'task',
    description: '',
    enabled: true,
    schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *' },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: PayloadKind.AgentTurn, message: 'go' },
    delivery: { mode: DeliveryMode.None },
    workspaceId: 'workspace-1',
  });
  expect((await service.listJobs())[0].id).toBe(task.id);
  expect(client.upsert).toHaveBeenCalledOnce();
  client.upsert.mockClear();
  await service.armSavedSchedules();
  expect(client.upsert).toHaveBeenCalledExactlyOnceWith({
    taskId: task.id,
    scheduleVersion: task.scheduleVersion,
    schedule: task.schedule,
  });
  await service.runJob(task.id);
  expect(await service.listRuns(task.id)).toHaveLength(1);
  await service.removeJob(task.id);
  expect(await service.getJob(task.id)).toBeNull();
  await service.stop();
  expect(client.stop).toHaveBeenCalledOnce();
});

test('keeps canonical mutations when the clock projection fails', async () => {
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  const store = new SqliteScheduledTaskStore(db);
  const client = {
    stop: vi.fn(),
    upsert: vi.fn(async () => {
      throw new Error('clock projection failed');
    }),
    remove: vi.fn(async () => {
      throw new Error('clock projection failed');
    }),
  };
  const service = new CanonicalScheduledTaskService(
    store,
    new SchedulerRuntime(store, client, async () => ({ sessionId: 'pi' })),
  );
  const task = await service.addJob({
    name: 'offline',
    description: '',
    enabled: true,
    schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: PayloadKind.AgentTurn, message: 'go' },
    delivery: { mode: DeliveryMode.None },
    workspaceId: 'workspace-1',
  });
  expect(await service.getJob(task.id)).not.toBeNull();
  const updated = await service.updateJob(task.id, { enabled: false });
  expect(updated.enabled).toBe(false);
  await service.removeJob(task.id);
  expect(await service.getJob(task.id)).toBeNull();
});

test('restores a saved schedule into the runtime clock and stops future triggers', async () => {
  vi.useFakeTimers();
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  const store = new SqliteScheduledTaskStore(db);
  const execute = vi.fn(async () => ({ sessionId: 'pi' }));
  const service = new CanonicalScheduledTaskService(
    store,
    new SchedulerRuntime(store, undefined, execute),
  );
  const task = store.create({
    name: 'saved task',
    description: '',
    enabled: true,
    schedule: { kind: ScheduleKind.Every, everyMs: 1000, anchorMs: Date.now() + 1000 },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: PayloadKind.AgentTurn, message: 'go' },
    delivery: { mode: DeliveryMode.None },
  });
  try {
    await service.armSavedSchedules();
    await vi.advanceTimersByTimeAsync(1000);
    expect(execute).toHaveBeenCalledOnce();
    expect(await service.listRuns(task.id)).toMatchObject([
      { status: TaskStatus.Success, sessionId: 'pi' },
    ]);
    await service.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(execute).toHaveBeenCalledOnce();
  } finally {
    await service.stop();
    db.close();
    vi.useRealTimers();
  }
});
