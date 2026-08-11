import { expect, test, vi } from 'vitest';
import { ScheduleKind } from './constants';
import { DeferredCcConnectCronClient } from './deferredCcConnectCronClient';

test('retains canonical projection while sidecar is offline and reconciles on attach', async () => {
  const deferred = new DeferredCcConnectCronClient();
  const task = { accountId: 'account-a', taskId: 'a', scheduleVersion: 'v1', schedule: { kind: ScheduleKind.Every, everyMs: 1000 } } as const;
  await deferred.upsert(task);
  const client = { upsert: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
  await deferred.attach('account-a', client);
  expect(client.upsert).toHaveBeenCalledWith(task);
  await deferred.remove(task);
  expect(client.remove).toHaveBeenCalledWith(task);
});

test('projects each channel account only to its own sidecar', async () => {
  const deferred = new DeferredCcConnectCronClient();
  const accountA = { accountId: 'account-a', taskId: 'a', scheduleVersion: 'v1', schedule: { kind: ScheduleKind.Every, everyMs: 1000 } } as const;
  const accountB = { accountId: 'account-b', taskId: 'b', scheduleVersion: 'v1', schedule: { kind: ScheduleKind.Every, everyMs: 2000 } } as const;
  const clientA = { upsert: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
  const clientB = { upsert: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };

  await deferred.upsert(accountA);
  await deferred.upsert(accountB);
  await deferred.attach('account-a', clientA);
  expect(clientA.upsert).toHaveBeenCalledWith(accountA);
  expect(clientA.upsert).not.toHaveBeenCalledWith(accountB);

  await deferred.attach('account-b', clientB);
  expect(clientB.upsert).toHaveBeenCalledWith(accountB);
  await deferred.remove(accountA);
  expect(clientA.remove).toHaveBeenCalledWith(accountA);
  expect(clientB.remove).not.toHaveBeenCalled();
});
