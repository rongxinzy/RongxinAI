import { ChannelRunStatus, ChannelRunTrigger } from '../../../shared/channelRun/constants';

/** Trigger filter values for the activity feed. */
export const ActivityTriggerFilter = {
  All: 'all',
  Channel: ChannelRunTrigger.Channel,
  Cron: ChannelRunTrigger.Cron,
} as const;
export type ActivityTriggerFilter =
  (typeof ActivityTriggerFilter)[keyof typeof ActivityTriggerFilter];

/** Status filter values for the activity feed. */
export const ActivityStatusFilter = {
  All: 'all',
  Started: ChannelRunStatus.Started,
  Completed: ChannelRunStatus.Completed,
  Failed: ChannelRunStatus.Failed,
} as const;
export type ActivityStatusFilter = (typeof ActivityStatusFilter)[keyof typeof ActivityStatusFilter];
