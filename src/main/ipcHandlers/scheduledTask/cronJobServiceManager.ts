import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';

export interface CronJobServiceDeps {
  /** SQLite-backed canonical scheduler; never fall back to an Agent runtime. */
  getScheduledTaskService: () => ScheduledTaskService;
}

let cronJobService: ScheduledTaskService | null = null;
let deps: CronJobServiceDeps | null = null;

export function initCronJobServiceManager(d: CronJobServiceDeps): void {
  deps = d;
}

export function getCronJobService(): ScheduledTaskService {
  if (!cronJobService) {
    if (!deps) {
      throw new Error(
        'CronJobServiceManager not initialized. Call initCronJobServiceManager() first.',
      );
    }
    cronJobService = deps.getScheduledTaskService();
  }
  return cronJobService;
}
