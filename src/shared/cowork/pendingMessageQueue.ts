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

export const CoworkQueueAttachmentLimit = {
  MaxImages: 4,
  MaxImageBase64Chars: 20 * 1024 * 1024,
} as const;

export interface CoworkQueuedImageAttachment {
  name: string;
  mimeType: string;
  base64Data: string;
}

export interface CoworkQueuedFileAttachment {
  name: string;
  path: string;
  extension: string;
  isImage?: boolean;
}

export interface CoworkPendingMessage {
  id: string;
  text: string;
  delivery: CoworkQueueDelivery;
  createdAt: number;
  status: CoworkQueueItemStatus;
  imageAttachments?: CoworkQueuedImageAttachment[];
  fileAttachments?: CoworkQueuedFileAttachment[];
  skillIds?: string[];
  /** Immutable prompt snapshot used when a queued item is immediately steered. */
  skillPrompt?: string;
  productionLoopMode?: import('../productionLoop').ProductionLoopMode;
  error?: string;
}
