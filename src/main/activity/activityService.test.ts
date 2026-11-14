import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { ActivityRetention, ActivitySource, ActivityStatus } from '../../shared/activity/constants';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

test('persists activity snapshots by run id and returns newest updates first', async () => {
  const { ActivityService } = await import('./activityService');
  const service = new ActivityService(new Database(':memory:'));
  service.upsert({
    id: 'first-task',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Running,
    inputPreview: 'hello',
    updatedAt: 1,
  });
  service.upsert({
    id: 'task',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Running,
    taskName: 'Daily report',
    updatedAt: 2,
  });
  service.upsert({
    id: 'first-task',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Completed,
    replyPreview: 'done',
    updatedAt: 3,
  });

  expect(service.list()).toEqual([
    expect.objectContaining({
      id: 'first-task',
      status: ActivityStatus.Completed,
      inputPreview: 'hello',
      replyPreview: 'done',
    }),
    expect.objectContaining({ id: 'task', taskName: 'Daily report' }),
  ]);
});

test('ignores an out-of-order update without broadcasting it', async () => {
  const sends: unknown[] = [];
  vi.doMock('electron', () => ({
    BrowserWindow: {
      getAllWindows: () => [
        {
          isDestroyed: () => false,
          webContents: { send: (_channel: string, run: unknown) => sends.push(run) },
        },
      ],
    },
  }));
  const { ActivityService } = await import('./activityService');
  const service = new ActivityService(new Database(':memory:'));
  service.upsert({
    id: 'run',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Running,
    updatedAt: 10,
  });
  const result = service.upsert({
    id: 'run',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Failed,
    errorMessage: 'late',
    updatedAt: 5,
  });
  expect(result).toMatchObject({ status: ActivityStatus.Running, updatedAt: 10 });
  expect(service.list()[0]).toMatchObject({ status: ActivityStatus.Running, updatedAt: 10 });
});

test('prunes only activity snapshots older than 180 days', async () => {
  const { ActivityService } = await import('./activityService');
  const service = new ActivityService(new Database(':memory:'));
  const now = Date.UTC(2026, 7, 13);
  service.upsert({
    id: 'expired',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Completed,
    updatedAt: now - ActivityRetention.Milliseconds - 1,
  });
  service.upsert({
    id: 'boundary',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Completed,
    updatedAt: now - ActivityRetention.Milliseconds,
  });
  service.upsert({
    id: 'recent',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Completed,
    updatedAt: now - 1,
  });

  expect(service.pruneExpired(now)).toBe(1);
  expect(service.list().map(run => run.id)).toEqual(['recent', 'boundary']);
});

test('keeps a persisted run pending until its resumed execution finishes', async () => {
  const { ActivityService } = await import('./activityService');
  const db = new Database(':memory:');
  const service = new ActivityService(db);
  service.upsert({
    id: 'stale',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Running,
    updatedAt: 10,
  });
  service.upsert({
    id: 'done',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Completed,
    updatedAt: 11,
  });

  const restartedService = new ActivityService(db);
  expect(restartedService.list()).toEqual([
    expect.objectContaining({ id: 'done', status: ActivityStatus.Completed, updatedAt: 11 }),
    expect.objectContaining({
      id: 'stale',
      status: ActivityStatus.Running,
      updatedAt: 10,
    }),
  ]);
  restartedService.upsert({
    id: 'stale',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Completed,
    replyPreview: 'Resumed result',
    updatedAt: 12,
  });
  expect(restartedService.list()).toHaveLength(2);
  expect(restartedService.list()[0]).toMatchObject({
    id: 'stale',
    status: ActivityStatus.Completed,
    startedAt: 10,
    replyPreview: 'Resumed result',
  });
});
