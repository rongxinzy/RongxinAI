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
