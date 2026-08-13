import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { ActivitySource, ActivityStatus } from '../../shared/activity/constants';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

test('persists activity snapshots by run id and returns newest updates first', async () => {
  const { ActivityService } = await import('./activityService');
  const service = new ActivityService(new Database(':memory:'));
  service.upsert({ id: 'channel', source: ActivitySource.Channel, status: ActivityStatus.Running, inputPreview: 'hello', updatedAt: 1 });
  service.upsert({ id: 'task', source: ActivitySource.ScheduledTask, status: ActivityStatus.Running, taskName: 'Daily report', updatedAt: 2 });
  service.upsert({ id: 'channel', source: ActivitySource.Channel, status: ActivityStatus.Completed, replyPreview: 'done', updatedAt: 3 });

  expect(service.list()).toEqual([
    expect.objectContaining({ id: 'channel', status: ActivityStatus.Completed, inputPreview: 'hello', replyPreview: 'done' }),
    expect.objectContaining({ id: 'task', taskName: 'Daily report' }),
  ]);
});

test('ignores an out-of-order update without broadcasting it', async () => {
  const sends: unknown[] = [];
  vi.doMock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_channel: string, run: unknown) => sends.push(run) } }] } }));
  const { ActivityService } = await import('./activityService');
  const service = new ActivityService(new Database(':memory:'));
  service.upsert({ id: 'run', source: ActivitySource.Channel, status: ActivityStatus.Running, updatedAt: 10 });
  const result = service.upsert({ id: 'run', source: ActivitySource.Channel, status: ActivityStatus.Failed, errorMessage: 'late', updatedAt: 5 });
  expect(result).toMatchObject({ status: ActivityStatus.Running, updatedAt: 10 });
  expect(service.list()[0]).toMatchObject({ status: ActivityStatus.Running, updatedAt: 10 });
});
