import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';
import { initializeScheduledTaskSchema } from '../../scheduledTask/schema';
import { initializeActivitySchema } from './schema';

import {
  ActivityErrorCode,
  ActivityRetention,
  ActivitySource,
  ActivityStatus,
} from '../../shared/activity/constants';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

test('persists activity snapshots by run id and returns newest updates first', async () => {
  const { ActivityService } = await import('./activityService');
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  initializeActivitySchema(db);
  expect(
    db
      .prepare(
        "SELECT name FROM pragma_table_info('zhiyuan_activity_runs') WHERE name = 'input_preview'",
      )
      .get(),
  ).toBeUndefined();
  db.exec('ALTER TABLE zhiyuan_activity_runs ADD COLUMN input_preview TEXT');
  const service = new ActivityService(db);
  service.recordChannelRun({
    id: 'channel',
    status: ActivityStatus.Running,
    updatedAt: 1,
  });
  db.prepare('UPDATE zhiyuan_activity_runs SET input_preview = ? WHERE id = ?').run(
    'legacy input',
    'channel',
  );
  db.prepare(`INSERT INTO zhiyuan_activity_runs (id, source, status, task_name, started_at, updated_at)
    VALUES ('task', ?, ?, 'Daily report', 2, 2)`).run(
    ActivitySource.ScheduledTask,
    ActivityStatus.Running,
  );
  service.recordChannelRun({
    id: 'channel',
    status: ActivityStatus.Completed,
    replyPreview: 'done',
    updatedAt: 3,
  });

  expect(service.list()).toEqual([
    expect.objectContaining({
      id: 'channel',
      status: ActivityStatus.Completed,
      replyPreview: 'done',
    }),
    expect.objectContaining({ id: 'task', taskName: 'Daily report' }),
  ]);
  expect(service.list()[0]).not.toHaveProperty('inputPreview');
  expect(
    db
      .prepare('SELECT input_preview FROM zhiyuan_activity_runs WHERE id = ?')
      .pluck()
      .get('channel'),
  ).toBe('legacy input');
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
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  initializeActivitySchema(db);
  const service = new ActivityService(db);
  service.recordChannelRun({
    id: 'run',
    status: ActivityStatus.Running,
    updatedAt: 10,
  });
  const result = service.recordChannelRun({
    id: 'run',
    status: ActivityStatus.Failed,
    errorMessage: 'late',
    updatedAt: 5,
  });
  expect(result).toMatchObject({ status: ActivityStatus.Running, updatedAt: 10 });
  expect(service.list()[0]).toMatchObject({ status: ActivityStatus.Running, updatedAt: 10 });
});

test('keeps the name and preview of existing Cron snapshots alongside their canonical status', async () => {
  const { ActivityService } = await import('./activityService');
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  initializeActivitySchema(db);
  const service = new ActivityService(db);
  const started = new Date().toISOString();
  db.prepare(`INSERT INTO zhiyuan_scheduled_task_runs
    (id, task_id, schedule_version, status, started_at, finished_at)
    VALUES ('legacy-cron', 'deleted-task', '1', 'success', ?, ?)`).run(started, started);
  db.prepare(`INSERT INTO zhiyuan_activity_runs
    (id, source, status, task_name, reply_preview, started_at, updated_at)
    VALUES ('legacy-cron', ?, ?, 'Historical task', 'Historical reply', 1, 1)`).run(
    ActivitySource.ScheduledTask,
    ActivityStatus.Running,
  );
  expect(service.recordChannelRun({ id: 'legacy-cron', status: ActivityStatus.Failed })).toBeNull();

  expect(service.list()).toMatchObject([
    {
      id: 'legacy-cron',
      status: ActivityStatus.Completed,
      taskName: 'Historical task',
      replyPreview: 'Historical reply',
    },
  ]);
  db.close();
});

test('prunes only activity snapshots older than 180 days', async () => {
  const { ActivityService } = await import('./activityService');
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  initializeActivitySchema(db);
  const service = new ActivityService(db);
  const now = Date.UTC(2026, 7, 13);
  service.recordChannelRun({
    id: 'expired',
    status: ActivityStatus.Completed,
    updatedAt: now - ActivityRetention.Milliseconds - 1,
  });
  service.recordChannelRun({
    id: 'boundary',
    status: ActivityStatus.Completed,
    updatedAt: now - ActivityRetention.Milliseconds,
  });
  service.recordChannelRun({
    id: 'recent',
    status: ActivityStatus.Completed,
    updatedAt: now - 1,
  });

  expect(service.pruneExpired(now)).toBe(1);
  expect(service.list().map(run => run.id)).toEqual(['recent', 'boundary']);
});

test('recovers interrupted running snapshots during startup', async () => {
  const { ActivityService } = await import('./activityService');
  const db = new Database(':memory:');
  initializeScheduledTaskSchema(db);
  initializeActivitySchema(db);
  const service = new ActivityService(db);
  db.prepare(`INSERT INTO zhiyuan_activity_runs (id, source, status, started_at, updated_at)
    VALUES ('stale', ?, ?, 10, 10)`).run(ActivitySource.ScheduledTask, ActivityStatus.Running);
  service.recordChannelRun({
    id: 'done',
    status: ActivityStatus.Completed,
    updatedAt: 11,
  });

  expect(service.recoverInterruptedRuns()).toBe(1);
  // Recovery keeps the run's own timestamp: a run that died days ago must not
  // jump to the top of today's feed just because the app restarted.
  expect(service.list()).toEqual([
    expect.objectContaining({ id: 'done', status: ActivityStatus.Completed, updatedAt: 11 }),
    expect.objectContaining({
      id: 'stale',
      status: ActivityStatus.Failed,
      updatedAt: 10,
      errorMessage: ActivityErrorCode.Interrupted,
    }),
  ]);
});
