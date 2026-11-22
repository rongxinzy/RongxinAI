import { DeliveryMode, DeliveryStatus } from './constants';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';
import type { ScheduledTask, ScheduledTaskDeliveryRecord, ScheduledTaskRun } from './types';

export type SchedulerDeliveryTransport = {
  send(
    input: { task: ScheduledTask; run: ScheduledTaskRun; content: string },
    signal?: AbortSignal,
  ): Promise<{ receiptId?: string | null }>;
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
    signal?: AbortSignal,
  ): Promise<ScheduledTaskDeliveryRecord> {
    const record: Omit<ScheduledTaskDeliveryRecord, 'id' | 'attemptedAt' | 'status'> = {
      runId: run.id,
      taskId: task.id,
      mode: task.delivery.mode,
      channel: task.delivery.channel ?? null,
      to: task.delivery.to ?? null,
      accountId: task.delivery.accountId ?? null,
      deliveredAt: null,
      receiptId: null,
      error: null,
    };
    const skipped = task.delivery.mode === DeliveryMode.None;
    if (skipped || !output?.trim()) {
      return this.store.createDelivery({
        ...record,
        status: skipped ? DeliveryStatus.Skipped : DeliveryStatus.Error,
        error: skipped ? null : 'Pi completed without user-visible output',
      });
    }
    const delivery = this.store.createDelivery({ ...record, status: DeliveryStatus.Pending });
    let receipt: Awaited<ReturnType<SchedulerDeliveryTransport['send']>>;
    try {
      receipt = await this.transport.send({ task, run, content: output }, signal);
    } catch (error) {
      return this.store.finishDelivery(delivery.id, {
        status: DeliveryStatus.Error,
        deliveredAt: null,
        receiptId: null,
        error:
          signal?.aborted && error === signal.reason
            ? 'Delivery confirmation interrupted by application shutdown'
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }
    return this.store.finishDelivery(delivery.id, {
      status: DeliveryStatus.Success,
      deliveredAt: new Date().toISOString(),
      receiptId: receipt.receiptId ?? null,
      error: null,
    });
  }
}
