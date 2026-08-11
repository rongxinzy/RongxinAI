import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { CanonicalScheduledTaskService } from './canonicalScheduledTaskService';
import { DeliveryMode, PayloadKind, ScheduleKind, SessionTarget, WakeMode } from './constants';
import { CcConnectSchedulerRuntime } from './ccConnectSchedulerRuntime';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

test('persists canonical task before projecting and exposes renderer operations', async () => {
  const store = new SqliteScheduledTaskStore(new Database(':memory:'));
  const client = { upsert: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
  const runtime = new CcConnectSchedulerRuntime(store, client, async () => ({ sessionId: 'pi' }));
  const service = new CanonicalScheduledTaskService(store, runtime);
  const task = await service.addJob({ name: 'task', description: '', enabled: true,
    schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *' }, sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat, payload: { kind: PayloadKind.AgentTurn, message: 'go' },
    delivery: { mode: DeliveryMode.None }, agentId: 'main' });
  expect((await service.listJobs())[0].id).toBe(task.id);
  expect(client.upsert).toHaveBeenCalledOnce();
  await service.runJob(task.id);
  expect(await service.countRuns(task.id)).toBe(1);
  await service.removeJob(task.id);
  expect(await service.getJob(task.id)).toBeNull();
});
