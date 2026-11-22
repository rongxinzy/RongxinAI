/**
 * Scheduled-task IPC registration (work package I: domain-owned registration,
 * `registerXxxIpc(deps)` shape). The module takes its collaborators as
 * injection — nothing here imports appBootstrap, so the domain layer stays
 * free of the bootstrap service locator.
 */
import type { ActivityService } from '../main/activity/activityService';
import { registerActivityIpcHandlers } from '../main/activity/ipcHandlers';
import type { IMStore } from '../main/im/imStore';
import type { ScheduledTaskService } from './scheduledTaskService';
import { registerScheduledTaskHandlers } from '../main/ipcHandlers/scheduledTask';

export interface ScheduledTaskIpcDeps {
  /** Opens (and lazily creates) the shared activity service. */
  getActivityService: () => ActivityService;
  /** The canonical SQLite + Pi scheduled task service. */
  getScheduledTaskService: () => ScheduledTaskService;
  getIMStore: () => IMStore;
}

export function registerScheduledTaskIpc(deps: ScheduledTaskIpcDeps): void {
  registerActivityIpcHandlers(deps.getActivityService);

  registerScheduledTaskHandlers({
    getCronJobService: deps.getScheduledTaskService,
    getIMStore: deps.getIMStore,
  });
}
