import { ActivitySource, ActivityStatus } from '../../../shared/activity/constants';

/** Trigger filter values for the activity feed. */
export const ActivityTriggerFilter = {
  All: 'all',
  Channel: ActivitySource.Channel,
  Cron: ActivitySource.ScheduledTask,
} as const;
export type ActivityTriggerFilter =
  (typeof ActivityTriggerFilter)[keyof typeof ActivityTriggerFilter];

/** Status filter values for the activity feed. */
export const ActivityStatusFilter = {
  All: 'all',
  Started: ActivityStatus.Running,
  Completed: ActivityStatus.Completed,
  Failed: ActivityStatus.Failed,
} as const;
export type ActivityStatusFilter = (typeof ActivityStatusFilter)[keyof typeof ActivityStatusFilter];
