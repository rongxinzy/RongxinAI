/**
 * Scheduled-task IPC registration (work package I: domain-owned registration,
 * `registerXxxIpc(deps)` shape). The module takes its collaborators as
 * injection — nothing here imports appBootstrap, so the domain layer stays
 * free of the bootstrap service locator.
 */
import { ActivityService } from '../main/activity/activityService';
import { registerActivityIpcHandlers } from '../main/activity/ipcHandlers';
import { ChannelAccountManager } from '../main/im/channelAccountManager';
import type { IMStore } from '../main/im/imStore';
import type { Platform } from '../shared/platform';
import type { ScheduledTaskService } from './scheduledTaskService';
import {
  getCronJobService,
  initCronJobServiceManager,
  initScheduledTaskHelpers,
  registerScheduledTaskHandlers,
} from '../main/ipcHandlers/scheduledTask';

export interface ScheduledTaskIpcDeps {
  /** Opens (and lazily creates) the shared activity service. */
  getActivityService: () => ActivityService;
  /** The canonical SQLite + Pi scheduled task service. */
  getScheduledTaskService: () => ScheduledTaskService;
  /** Channel account manager used for delivery routing helpers. */
  getIMGatewayManager: () => ChannelAccountManager;
}

export function registerScheduledTaskIpc(deps: ScheduledTaskIpcDeps): void {
  registerActivityIpcHandlers(deps.getActivityService);

  initCronJobServiceManager({
    getScheduledTaskService: deps.getScheduledTaskService,
  });
  initScheduledTaskHelpers({
    getIMGatewayManager: () => ({
      // The helper contract wants a plain record; IMGatewayConfig is an interface.
      getConfig: () => deps.getIMGatewayManager().getConfig() as unknown as Record<string, unknown>,
    }),
  });
  registerScheduledTaskHandlers({
    getCronJobService,
    getIMGatewayManager: () => ({
      getIMStore: (): Pick<IMStore, 'getSessionMapping' | 'listSessionMappings'> => {
        const store = deps.getIMGatewayManager().getIMStore();
        return {
          getSessionMapping: (conversationId: string, platform: string) =>
            store.getSessionMapping(conversationId, platform as Platform),
          listSessionMappings: (platform: string, accountId?: string) =>
            store.listSessionMappings(platform as Platform, accountId),
        };
      },
    }),
  });
}
