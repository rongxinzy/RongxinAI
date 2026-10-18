import type { ActivityRun } from '../../shared/activity/types';
import { ActivityIpc } from '../../shared/activity/constants';
import { IpcChannel as ScheduledTaskIpc } from '../../scheduledTask/constants';
import type { IpcContractApi } from '../../shared/ipc/contract';
import type { activityContract, scheduledTasksContract } from '../../shared/ipc/automationContract';
import {
  activityContractChannels,
  scheduledTasksContractChannels,
} from '../../shared/ipc/automationContract.channels';
import { onPush, onPushVoid } from './pushChannel';
import { createIpcInvokers } from './createIpcInvokers';

// Scheduled tasks (cron) and the activity run feed. Invoke methods come from
// the contract channel maps; push subscriptions stay hand-wired.
export const automationApi = {
  scheduledTasks: {
    ...createIpcInvokers(scheduledTasksContractChannels),
    onStatusUpdate: (callback: (data: unknown) => void) =>
      onPush(ScheduledTaskIpc.StatusUpdate, callback),
    onRunUpdate: (callback: (data: unknown) => void) =>
      onPush(ScheduledTaskIpc.RunUpdate, callback),
    onRefresh: (callback: () => void) => onPushVoid(ScheduledTaskIpc.Refresh, callback),
  } as IpcContractApi<typeof scheduledTasksContract> & {
    onStatusUpdate: (callback: (data: unknown) => void) => () => void;
    onRunUpdate: (callback: (data: unknown) => void) => () => void;
    onRefresh: (callback: () => void) => () => void;
  },

  activity: {
    ...createIpcInvokers(activityContractChannels),
    onUpdated: (callback: (run: ActivityRun) => void) => onPush(ActivityIpc.Updated, callback),
  } as IpcContractApi<typeof activityContract> & {
    onUpdated: (callback: (run: ActivityRun) => void) => () => void;
  },
};
