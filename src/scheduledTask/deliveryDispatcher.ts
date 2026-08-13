import { DeliveryMode, DeliveryStatus } from './constants';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';
import type { ScheduledTask, ScheduledTaskDeliveryRecord, ScheduledTaskRun } from './types';

export type SchedulerDeliveryTransport = {
  send(input: {
    task: ScheduledTask;
    run: ScheduledTaskRun;
    content: string;
  }): Promise<{ receiptId?: string | null }>;
};

/**
 * Persists the local Delivery attempt before any channel I/O.  The channel
 * sidecar is a transport only: receipt/error ownership remains in SQLite.
 */
export class ScheduledTaskDeliveryDispatcher {
  constructor(
    private readonly store: SqliteScheduledTaskStore,
    private readonly transport: SchedulerDeliveryTransport,
  ) {}

  async dispatch(
    task: ScheduledTask,
    run: ScheduledTaskRun,
    output: string | null,
  ): Promise<ScheduledTaskDeliveryRecord> {
    const delivery = this.store.createDelivery({
      runId: run.id,
      taskId: task.id,
      mode: task.delivery.mode,
      channel: task.delivery.channel ?? null,
      to: task.delivery.to ?? null,
      accountId: task.delivery.accountId ?? null,
      status: DeliveryStatus.Pending,
      deliveredAt: null,
      receiptId: null,
      error: null,
    });
    if (task.delivery.mode === DeliveryMode.None) {
      return this.store.finishDelivery(delivery.id, {
        status: DeliveryStatus.Skipped,
        deliveredAt: null,
        receiptId: null,
        error: null,
      });
    }
    if (!output?.trim()) {
      return this.store.finishDelivery(delivery.id, {
        status: DeliveryStatus.Error,
        deliveredAt: null,
        receiptId: null,
        error: 'Pi completed without user-visible output',
      });
    }
    try {
      const receipt = await this.transport.send({ task, run, content: output });
      return this.store.finishDelivery(delivery.id, {
        status: DeliveryStatus.Success,
        deliveredAt: new Date().toISOString(),
        receiptId: receipt.receiptId ?? null,
        error: null,
      });
    } catch (error) {
      return this.store.finishDelivery(delivery.id, {
        status: DeliveryStatus.Error,
        deliveredAt: null,
        receiptId: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
