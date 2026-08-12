/**
 * Work-only pending message queue shared by the Electron main process and
 * renderer. Queue state is intentionally in-memory and scoped to a live
 * session; it is not part of the persisted cowork session protocol.
 */

export const CoworkQueueDelivery = {
  Steer: 'steer',
  FollowUp: 'followUp',
} as const;

export type CoworkQueueDelivery =
  (typeof CoworkQueueDelivery)[keyof typeof CoworkQueueDelivery];

export const CoworkQueueItemStatus = {
  Pending: 'pending',
  Sending: 'sending',
  Failed: 'failed',
} as const;

export type CoworkQueueItemStatus =
  (typeof CoworkQueueItemStatus)[keyof typeof CoworkQueueItemStatus];

export interface CoworkPendingMessage {
  id: string;
  text: string;
  delivery: CoworkQueueDelivery;
  createdAt: number;
  status: CoworkQueueItemStatus;
  error?: string;
}

