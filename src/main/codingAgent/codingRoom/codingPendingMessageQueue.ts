import { randomUUID } from 'crypto';

import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { CodingErrorMessage } from '../../../shared/codingAgent';

/**
 * Follow-up prompt queue for ACP lanes, extracted from the service
 * inheritance chain as a collaborator (work package I.3). Owns the queue
 * state; delivery timing stays with the service (turnExecution marks items
 * Sending and prompts through the lane lifecycle).
 */
export class CodingPendingMessageQueue {
  private readonly itemsByLane = new Map<string, CoworkPendingMessage[]>();

  list(laneId: string): CoworkPendingMessage[] {
    return (this.itemsByLane.get(laneId) ?? []).map(item => ({ ...item }));
  }

  find(laneId: string, itemId: string): CoworkPendingMessage | undefined {
    return (this.itemsByLane.get(laneId) ?? []).find(candidate => candidate.id === itemId);
  }

  enqueue(
    laneId: string,
    text: string,
  ): { success: boolean; item?: CoworkPendingMessage; error?: string } {
    const normalized = text.trim();
    if (!normalized) return { success: false, error: CodingErrorMessage.MessageTextRequired };
    const item: CoworkPendingMessage = {
      id: randomUUID(),
      text: normalized,
      delivery: CoworkQueueDelivery.FollowUp,
      createdAt: Date.now(),
      status: CoworkQueueItemStatus.Pending,
    };
    const items = this.itemsByLane.get(laneId) ?? [];
    items.push(item);
    this.itemsByLane.set(laneId, items);
    return { success: true, item };
  }

  update(laneId: string, itemId: string, text: string): { success: boolean; error?: string } {
    const normalized = text.trim();
    if (!normalized) return { success: false, error: CodingErrorMessage.MessageTextRequired };
    const item = this.find(laneId, itemId);
    if (!item) return { success: false, error: CodingErrorMessage.PendingMessageNotFound };
    if (item.status === CoworkQueueItemStatus.Sending) {
      return { success: false, error: CodingErrorMessage.PendingMessageEditWhileSending };
    }
    item.text = normalized;
    item.status = CoworkQueueItemStatus.Pending;
    delete item.error;
    return { success: true };
  }

  delete(laneId: string, itemId: string): { success: boolean; error?: string } {
    const items = this.itemsByLane.get(laneId) ?? [];
    const next = items.filter(item => item.id !== itemId);
    if (next.length === items.length)
      return { success: false, error: CodingErrorMessage.PendingMessageNotFound };
    if (next.length) this.itemsByLane.set(laneId, next);
    else this.itemsByLane.delete(laneId);
    return { success: true };
  }

  /** Next pending follow-up for the lane, marked Sending by the caller. */
  findNextPending(laneId: string): CoworkPendingMessage | undefined {
    return (this.itemsByLane.get(laneId) ?? []).find(
      item => item.status === CoworkQueueItemStatus.Pending,
    );
  }

  fail(
    laneId: string,
    itemId: string,
    error: unknown,
    errorMessage: (error: unknown) => string,
  ): void {
    const item = this.find(laneId, itemId);
    if (!item) return;
    item.status = CoworkQueueItemStatus.Failed;
    item.error = errorMessage(error);
  }
}
