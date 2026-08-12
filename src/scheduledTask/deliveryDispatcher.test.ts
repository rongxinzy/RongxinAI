import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { DeliveryMode, PayloadKind, ScheduleKind, SessionTarget, WakeMode } from './constants';
import { ScheduledTaskDeliveryDispatcher } from './deliveryDispatcher';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

function setup(mode: DeliveryMode) {
  const store = new SqliteScheduledTaskStore(new Database(':memory:'));
  const task = store.create({ name: 'task', description: '', enabled: true,
    schedule: { kind: ScheduleKind.Every, everyMs: 60_000 }, sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat, payload: { kind: PayloadKind.AgentTurn, message: 'run' },
    delivery: mode === DeliveryMode.None ? { mode } : { mode, channel: 'telegram', to: '42', accountId: 'work' }, agentId: 'main' });
  const run = store.claimTrigger({ taskId: task.id, scheduleVersion: task.scheduleVersion!, scheduledAt: '2026-08-11T06:00:00.000Z' })!;
  const transport = { send: vi.fn(async () => ({ receiptId: 'receipt-1' })) };
  return { store, task, run, transport };
}

test('persists a skipped Delivery for mode none without calling the channel transport', async () => {
  const { store, task, run, transport } = setup(DeliveryMode.None);
  const delivery = await new ScheduledTaskDeliveryDispatcher(store, transport).dispatch(task, run, 'done');
  expect(delivery).toMatchObject({ status: 'skipped', deliveredAt: null });
  expect(transport.send).not.toHaveBeenCalled();
  expect(store.listDeliveries(run.id)).toEqual([delivery]);
});

test('records the sidecar receipt or error against the same pending Delivery', async () => {
  const { store, task, run, transport } = setup(DeliveryMode.Announce);
  const dispatcher = new ScheduledTaskDeliveryDispatcher(store, transport);
  await expect(dispatcher.dispatch(task, run, 'done')).resolves.toMatchObject({ status: 'success', receiptId: 'receipt-1' });
  transport.send.mockRejectedValueOnce(new Error('channel unavailable'));
  await expect(dispatcher.dispatch(task, run, 'retry')).resolves.toMatchObject({ status: 'error', error: 'channel unavailable' });
  expect(store.listDeliveries(run.id)).toHaveLength(2);
});
