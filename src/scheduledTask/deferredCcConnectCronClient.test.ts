import { expect, test, vi } from 'vitest';
import { ScheduleKind } from './constants';
import { DeferredCcConnectCronClient } from './deferredCcConnectCronClient';

test('retains canonical projection while sidecar is offline and reconciles on attach', async () => {
  const deferred = new DeferredCcConnectCronClient();
  const task = { taskId: 'a', scheduleVersion: 'v1', schedule: { kind: ScheduleKind.Every, everyMs: 1000 } } as const;
  await deferred.upsert(task);
  const client = { upsert: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
  await deferred.attach(client);
  expect(client.upsert).toHaveBeenCalledWith(task);
  await deferred.remove('a');
  expect(client.remove).toHaveBeenCalledWith('a');
});
