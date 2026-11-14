import type { ActivityService } from '../activity/activityService';

/** Read model for local execution activity; it owns no Agent or scheduling state. */
export const activityRuntime: { service: ActivityService | null } = { service: null };
