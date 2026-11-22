import type { ActivitySource, ActivityStatus } from './constants';

/** Display record for a channel or scheduled-task execution. */
export interface ActivityRun {
  id: string;
  source: ActivitySource;
  status: ActivityStatus;
  startedAt: number;
  updatedAt: number;
  sessionId?: string;
  platform?: string;
  conversationId?: string;
  taskName?: string;
  replyPreview?: string;
  errorMessage?: string;
}
