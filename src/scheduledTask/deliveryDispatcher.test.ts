import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import {
  DeliveryMode,
  DeliveryStatus,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  WakeMode,
} from './constants';
import { ScheduledTaskDeliveryDispatcher } from './deliveryDispatcher';
import { initializeScheduledTaskSchema } from './schema';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

function setup(mode: DeliveryMode) {
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
    delivery:
      mode === DeliveryMode.None
        ? { mode }
        : { mode, channel: 'telegram', to: '42', accountId: 'work' },
    workspaceId: 'workspace-1',
  });
  const run = store.claimTrigger({
    taskId: task.id,
    scheduleVersion: task.scheduleVersion!,
    scheduledAt: '2026-08-11T06:00:00.000Z',
  })!;
  const transport = { send: vi.fn(async () => ({ receiptId: 'receipt-1' })) };
  return { db, store, task, run, transport };
}

test.each([
  [DeliveryMode.None, 'done', DeliveryStatus.Skipped, null],
  [DeliveryMode.Announce, '  ', DeliveryStatus.Error, 'Pi completed without user-visible output'],
] as const)(
  'writes a single terminal delivery for %s mode with output %j',
  async (mode, output, status, error) => {
    const { db, store, task, run, transport } = setup(mode);
    try {
      db.exec(`CREATE TRIGGER reject_second_delivery_write
        BEFORE UPDATE ON zhiyuan_scheduled_task_deliveries
        BEGIN SELECT RAISE(ABORT, 'No transport attempt to update'); END;`);
      const delivery = await new ScheduledTaskDeliveryDispatcher(store, transport).dispatch(
        task,
        run,
        output,
      );
      expect(delivery).toMatchObject({ status, error, deliveredAt: null });
      expect(transport.send).not.toHaveBeenCalled();
      expect(store.listDeliveries(run.id)).toEqual([delivery]);
    } finally {
      db.close();
    }
  },
);

test('records the sidecar receipt or error against the same pending Delivery', async () => {
  const { store, task, run, transport } = setup(DeliveryMode.Announce);
  const dispatcher = new ScheduledTaskDeliveryDispatcher(store, transport);
  await expect(dispatcher.dispatch(task, run, 'done')).resolves.toMatchObject({
    status: DeliveryStatus.Success,
    receiptId: 'receipt-1',
  });
  transport.send.mockRejectedValueOnce(new Error('channel unavailable'));
  await expect(dispatcher.dispatch(task, run, 'retry')).resolves.toMatchObject({
    status: DeliveryStatus.Error,
    error: 'channel unavailable',
  });
  expect(store.listDeliveries(run.id)).toHaveLength(2);
});

test('does not turn a failed receipt write into a transport failure', async () => {
  const { db, store, task, run, transport } = setup(DeliveryMode.Announce);
  try {
    db.exec(`CREATE TRIGGER reject_receipt_write
      BEFORE UPDATE ON zhiyuan_scheduled_task_deliveries WHEN NEW.status = '${DeliveryStatus.Success}'
      BEGIN SELECT RAISE(ABORT, 'Receipt write failed'); END;`);
    await expect(
      new ScheduledTaskDeliveryDispatcher(store, transport).dispatch(task, run, 'done'),
    ).rejects.toThrow('Receipt write failed');
    expect(transport.send).toHaveBeenCalledOnce();
    expect(store.listDeliveries(run.id)).toMatchObject([
      { status: DeliveryStatus.Pending, error: null, receiptId: null },
    ]);
  } finally {
    db.close();
  }
});
