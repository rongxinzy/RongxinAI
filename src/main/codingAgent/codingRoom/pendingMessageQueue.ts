import { randomUUID } from 'crypto';
import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { CodingErrorMessage } from '../../../shared/codingAgent';
import { CodingRoomServiceSessionLifecycle } from './sessionLifecycle';

/** Queue of follow-up prompts waiting for an ACP lane to finish its turn. */
export abstract class CodingRoomServicePendingMessageQueue extends CodingRoomServiceSessionLifecycle {
  listPendingMessages(laneId: string): CoworkPendingMessage[] {
    return (this.acpPendingMessages.get(laneId) ?? []).map(item => ({ ...item }));
  }

  protected emitPendingMessagesChanged(laneId: string): void {
    this.emit('pendingMessagesChanged', { laneId, items: this.listPendingMessages(laneId) });
  }

  enqueuePendingMessage(
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
    const items = this.acpPendingMessages.get(laneId) ?? [];
    items.push(item);
    this.acpPendingMessages.set(laneId, items);
    this.emitPendingMessagesChanged(laneId);
    return { success: true, item };
  }

  updatePendingMessage(
    laneId: string,
    itemId: string,
    text: string,
  ): { success: boolean; error?: string } {
    const normalized = text.trim();
    if (!normalized) return { success: false, error: CodingErrorMessage.MessageTextRequired };
    const items = this.acpPendingMessages.get(laneId) ?? [];
    const item = items.find(candidate => candidate.id === itemId);
    if (!item) return { success: false, error: CodingErrorMessage.PendingMessageNotFound };
    if (item.status === CoworkQueueItemStatus.Sending) {
      return { success: false, error: CodingErrorMessage.PendingMessageEditWhileSending };
    }
    item.text = normalized;
    item.status = CoworkQueueItemStatus.Pending;
    delete item.error;
    this.emitPendingMessagesChanged(laneId);
    return { success: true };
  }

  deletePendingMessage(laneId: string, itemId: string): { success: boolean; error?: string } {
    const items = this.acpPendingMessages.get(laneId) ?? [];
    const next = items.filter(item => item.id !== itemId);
    if (next.length === items.length)
      return { success: false, error: CodingErrorMessage.PendingMessageNotFound };
    if (next.length) this.acpPendingMessages.set(laneId, next);
    else this.acpPendingMessages.delete(laneId);
    this.emitPendingMessagesChanged(laneId);
    return { success: true };
  }

  protected failAcpPendingMessage(laneId: string, itemId: string, error: unknown): void {
    const item = (this.acpPendingMessages.get(laneId) ?? []).find(
      candidate => candidate.id === itemId,
    );
    if (!item) return;
    item.status = CoworkQueueItemStatus.Failed;
    item.error = this.errorMessage(error);
    this.emitPendingMessagesChanged(laneId);
  }
}
