/**
 * Channel/Cron run lifecycle events (issue #225 step 3).
 *
 * Channel-triggered runs (IM messages) and Cron-triggered runs execute
 * inside the OpenClaw domain and are NOT cowork workbench sessions. These
 * events expose them to the renderer as a read-only projection for the
 * future activity feed, on their own IPC channel instead of cowork:stream:*.
 */
export const ChannelRunStatus = {
  Started: 'started',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type ChannelRunStatus = (typeof ChannelRunStatus)[keyof typeof ChannelRunStatus];

export const ChannelRunTrigger = {
  /** Inbound IM/channel message. */
  Channel: 'channel',
  /** Scheduled cron task delivery. */
  Cron: 'cron',
} as const;
export type ChannelRunTrigger = (typeof ChannelRunTrigger)[keyof typeof ChannelRunTrigger];

export const ChannelRunIpc = {
  /** Main → renderer push of a ChannelRunSummary. */
  RunEvent: 'channel:run:event',
} as const;
export type ChannelRunIpc = (typeof ChannelRunIpc)[keyof typeof ChannelRunIpc];

/** Read-only summary of one Channel/Cron run lifecycle transition. */
export type ChannelRunSummary = {
  sessionId: string;
  platform: string;
  conversationId: string;
  trigger: ChannelRunTrigger;
  status: ChannelRunStatus;
  /** Epoch ms when this transition happened. */
  timestamp: number;
  /** First characters of the inbound message (started events). */
  inputPreview?: string;
  /** First characters of the produced reply (completed events). */
  replyPreview?: string;
  /** User-facing error text (failed events). */
  errorMessage?: string;
};
