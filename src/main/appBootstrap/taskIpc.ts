/** Scheduled-task and activity IPC registration. */
import { rt } from './runtimeState';
import { getStore } from './runtimeServices';
import { getCanonicalScheduledTaskService, getIMGatewayManager } from './ccConnectRuntime';
import { ActivityService } from '../activity/activityService';
import type { Platform } from '../../shared/platform';
import { registerActivityIpcHandlers } from '../activity/ipcHandlers';
import {
  getCronJobService,
  initCronJobServiceManager,
  initScheduledTaskHelpers,
  registerScheduledTaskHandlers,
} from '../ipcHandlers/scheduledTask';

export const registerTaskIpc = (): void => {
  // ==================== Scheduled Task IPC Handlers (canonical SQLite + Pi) ====================

  registerActivityIpcHandlers(() => {
    rt.activityService ??= new ActivityService(getStore().getDatabase());
    return rt.activityService;
  });

  initCronJobServiceManager({
    getScheduledTaskService: getCanonicalScheduledTaskService,
  });
  initScheduledTaskHelpers({
    getIMGatewayManager: () => ({
      getConfig: () => getIMGatewayManager().getConfig() as unknown as Record<string, unknown>,
    }),
  });
  registerScheduledTaskHandlers({
    getCronJobService,
    getIMGatewayManager: () => ({
      getIMStore: () => ({
        getSessionMapping: (conversationId: string, platform: string) =>
          getIMGatewayManager()
            .getIMStore()
            .getSessionMapping(conversationId, platform as Platform),
        listSessionMappings: (platform: string, accountId?: string) =>
          getIMGatewayManager()
            .getIMStore()
            .listSessionMappings(platform as Platform, accountId),
      }),
    }),
  });
};
