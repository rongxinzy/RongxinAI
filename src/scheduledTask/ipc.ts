import type { ActivityService } from '../main/activity/activityService';
import { registerActivityIpcHandlers } from '../main/activity/ipcHandlers';
import type { ScheduledTaskService } from './scheduledTaskService';
import { registerScheduledTaskHandlers } from '../main/ipcHandlers/scheduledTask';

export interface ScheduledTaskIpcDeps {
  getActivityService(): ActivityService;
  getScheduledTaskService(): ScheduledTaskService;
  resolveSession?(sessionKey: string): Record<string, unknown> | null;
}

export function registerScheduledTaskIpc(deps: ScheduledTaskIpcDeps): void {
  registerActivityIpcHandlers(deps.getActivityService);
  registerScheduledTaskHandlers({
    getScheduledTaskService: deps.getScheduledTaskService,
    resolveSession: deps.resolveSession,
  });
}
