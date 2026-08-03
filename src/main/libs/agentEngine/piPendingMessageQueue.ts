import { randomUUID } from 'crypto';

import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
  type CoworkPendingMessage,
  type CoworkQueueDelivery as CoworkQueueDeliveryType,
} from '../../../shared/cowork/pendingMessageQueue';

/**
 * Session-scoped in-memory queue for Work steer/follow-up messages.
 *
 * The adapter owns delivery and calls this store after each mutation so it can
 * broadcast the authoritative queue snapshot to every renderer window.
 */
export class PiPendingMessageQueue {
  private readonly itemsBySession = new Map<string, CoworkPendingMessage[]>();
  private readonly removedPositions = new Map<string, { sessionId: string; index: number }>();

  list(sessionId: string): CoworkPendingMessage[] {
    return (this.itemsBySession.get(sessionId) ?? []).map(item => ({ ...item }));
  }

  hasPendingFollowUp(sessionId: string): boolean {
    return this.findNextPending(sessionId, CoworkQueueDelivery.FollowUp) !== null;
  }

  findNextPending(
    sessionId: string,
    delivery: CoworkQueueDeliveryType,
  ): CoworkPendingMessage | null {
    const item = (this.itemsBySession.get(sessionId) ?? []).find(
      candidate =>
        candidate.status === CoworkQueueItemStatus.Pending && candidate.delivery === delivery,
    );
    return item ? { ...item } : null;
  }

  enqueue(
    sessionId: string,
    text: string,
    delivery: CoworkQueueDeliveryType = CoworkQueueDelivery.FollowUp,
  ): CoworkPendingMessage {
    const item: CoworkPendingMessage = {
      id: randomUUID(),
      text,
      delivery,
      createdAt: Date.now(),
      status: CoworkQueueItemStatus.Pending,
    };
    const items = this.itemsBySession.get(sessionId) ?? [];
    items.push(item);
    this.itemsBySession.set(sessionId, items);
    return { ...item };
  }

  update(sessionId: string, itemId: string, text: string): CoworkPendingMessage | null {
    const item = this.find(sessionId, itemId);
    if (!item) return null;
    item.text = text;
    item.status = CoworkQueueItemStatus.Pending;
    delete item.error;
    return { ...item };
  }

  remove(sessionId: string, itemId: string): boolean {
    const items = this.itemsBySession.get(sessionId);
    if (!items) return false;
    const index = items.findIndex(item => item.id === itemId);
    if (index < 0) return false;
    items.splice(index, 1);
    if (items.length === 0) this.itemsBySession.delete(sessionId);
    return true;
  }

  takeNext(sessionId: string, delivery: CoworkQueueDeliveryType): CoworkPendingMessage | null {
    const items = this.itemsBySession.get(sessionId);
    if (!items) return null;
    const index = items.findIndex(
      item => item.status === CoworkQueueItemStatus.Pending && item.delivery === delivery,
    );
    if (index < 0) return null;
    const [item] = items.splice(index, 1);
    this.removedPositions.set(item.id, { sessionId, index });
    if (items.length === 0) this.itemsBySession.delete(sessionId);
    return { ...item, status: CoworkQueueItemStatus.Sending };
  }

  take(
    sessionId: string,
    itemId: string,
    delivery?: CoworkQueueDeliveryType,
  ): CoworkPendingMessage | null {
    const items = this.itemsBySession.get(sessionId);
    if (!items) return null;
    const index = items.findIndex(item => item.id === itemId);
    if (index < 0 || (delivery && items[index].delivery !== delivery)) return null;
    const [item] = items.splice(index, 1);
    this.removedPositions.set(item.id, { sessionId, index });
    if (items.length === 0) this.itemsBySession.delete(sessionId);
    return { ...item, status: CoworkQueueItemStatus.Sending };
  }

  restore(sessionId: string, item: CoworkPendingMessage): CoworkPendingMessage {
    const items = this.itemsBySession.get(sessionId) ?? [];
    const existingIndex = items.findIndex(candidate => candidate.id === item.id);
    const restored: CoworkPendingMessage = {
      ...item,
      status: CoworkQueueItemStatus.Failed,
    };
    if (existingIndex >= 0) {
      items[existingIndex] = restored;
    } else {
      const removedPosition = this.removedPositions.get(item.id);
      const index =
        removedPosition?.sessionId === sessionId
          ? Math.min(removedPosition.index, items.length)
          : items.length;
      items.splice(index, 0, restored);
    }
    this.removedPositions.delete(item.id);
    this.itemsBySession.set(sessionId, items);
    return { ...restored };
  }

  finishDelivery(itemId: string): void {
    this.removedPositions.delete(itemId);
  }

  clear(sessionId: string): boolean {
    for (const [itemId, position] of this.removedPositions) {
      if (position.sessionId === sessionId) this.removedPositions.delete(itemId);
    }
    return this.itemsBySession.delete(sessionId);
  }

  private find(sessionId: string, itemId: string): CoworkPendingMessage | null {
    return this.itemsBySession.get(sessionId)?.find(item => item.id === itemId) ?? null;
  }
}
