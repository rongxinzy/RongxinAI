import { ipcRenderer } from 'electron';

import { ActivityIpc } from '../../shared/activity/constants';
import type { ActivityRun } from '../../shared/activity/types';
import { IpcChannel as ScheduledTaskIpc } from '../../scheduledTask/constants';
import { onPush, onPushVoid } from './pushChannel';

// Scheduled tasks (cron) and the activity run feed.
export const automationApi = {
  scheduledTasks: {
    list: () => ipcRenderer.invoke(ScheduledTaskIpc.List),
    get: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.Get, id),
    create: (input: unknown) => ipcRenderer.invoke(ScheduledTaskIpc.Create, input),
    update: (id: string, input: unknown) => ipcRenderer.invoke(ScheduledTaskIpc.Update, id, input),
    delete: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.Delete, id),
    toggle: (id: string, enabled: boolean) =>
      ipcRenderer.invoke(ScheduledTaskIpc.Toggle, id, enabled),

    runManually: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.RunManually, id),
    stop: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.Stop, id),
    preflight: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.Preflight, id),

    listRuns: (taskId: string, limit?: number, offset?: number, filter?: unknown) =>
      ipcRenderer.invoke(ScheduledTaskIpc.ListRuns, taskId, limit, offset, filter),
    listDeliveries: (runId: string) => ipcRenderer.invoke(ScheduledTaskIpc.ListDeliveries, runId),
    countRuns: (taskId: string) => ipcRenderer.invoke(ScheduledTaskIpc.CountRuns, taskId),
    listAllRuns: (limit?: number, offset?: number, filter?: unknown) =>
      ipcRenderer.invoke(ScheduledTaskIpc.ListAllRuns, limit, offset, filter),
    resolveSession: (sessionKey: string) =>
      ipcRenderer.invoke(ScheduledTaskIpc.ResolveSession, sessionKey),

    listChannels: () => ipcRenderer.invoke(ScheduledTaskIpc.ListChannels),
    listChannelConversations: (channel: string, accountId?: string, filterAccountId?: string) =>
      ipcRenderer.invoke(
        ScheduledTaskIpc.ListChannelConversations,
        channel,
        accountId,
        filterAccountId,
      ),

    onStatusUpdate: (callback: (data: unknown) => void) =>
      onPush(ScheduledTaskIpc.StatusUpdate, callback),
    onRunUpdate: (callback: (data: unknown) => void) =>
      onPush(ScheduledTaskIpc.RunUpdate, callback),
    onRefresh: (callback: () => void) => onPushVoid(ScheduledTaskIpc.Refresh, callback),
  },

  activity: {
    list: () => ipcRenderer.invoke(ActivityIpc.List),
    onUpdated: (callback: (run: ActivityRun) => void) => onPush(ActivityIpc.Updated, callback),
  },
};
