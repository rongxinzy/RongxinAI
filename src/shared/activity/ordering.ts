import { ActivityStatus } from './constants';
import type { ActivityRun } from './types';

const statusRank: Record<ActivityStatus, number> = {
  [ActivityStatus.Running]: 0,
  [ActivityStatus.Completed]: 1,
  [ActivityStatus.Failed]: 1,
};

export const shouldAcceptActivityUpdate = (current: ActivityRun, incoming: ActivityRun): boolean => {
  if (incoming.updatedAt > current.updatedAt) return true;
  if (incoming.updatedAt < current.updatedAt) return false;
  return statusRank[incoming.status] >= statusRank[current.status];
};
