export const ActivitySource = {
  Channel: 'channel',
  ScheduledTask: 'scheduledTask',
} as const;
export type ActivitySource = (typeof ActivitySource)[keyof typeof ActivitySource];

export const ActivityStatus = {
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type ActivityStatus = (typeof ActivityStatus)[keyof typeof ActivityStatus];

export const ActivityIpc = {
  List: 'activity:list',
  Updated: 'activity:updated',
} as const;

/**
 * Sentinel stored in `ActivityRun.errorMessage` when startup recovery closes a
 * run whose process died. It is a code, not prose: the renderer localizes it,
 * so it must never be displayed as-is.
 */
export const ActivityErrorCode = {
  Interrupted: 'activity:interrupted',
} as const;
export type ActivityErrorCode = (typeof ActivityErrorCode)[keyof typeof ActivityErrorCode];

/** Activity snapshots remain available after their source task is removed. */
export const ActivityRetention = {
  Days: 180,
  Milliseconds: 180 * 24 * 60 * 60 * 1000,
} as const;
