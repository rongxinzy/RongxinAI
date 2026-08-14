import type { ActivitySource, ActivityStatus } from './constants';

/** Durable, display-only snapshot of a channel or scheduled-task execution. */
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
  inputPreview?: string;
  replyPreview?: string;
  errorMessage?: string;
}

export type ActivityRunUpdate = Omit<ActivityRun, 'startedAt' | 'updatedAt'> & {
  startedAt?: number;
  updatedAt?: number;
};
