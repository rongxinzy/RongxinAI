import type { ActivitySource, ActivityStatus } from './constants';

/** Display-only snapshot of a local automation execution. */
export interface ActivityRun {
  id: string;
  source: ActivitySource;
  status: ActivityStatus;
  startedAt: number;
  updatedAt: number;
  sessionId?: string;
  taskName?: string;
  inputPreview?: string;
  replyPreview?: string;
  errorMessage?: string;
}

export type ActivityRunUpdate = Omit<ActivityRun, 'startedAt' | 'updatedAt'> & {
  startedAt?: number;
  updatedAt?: number;
};
