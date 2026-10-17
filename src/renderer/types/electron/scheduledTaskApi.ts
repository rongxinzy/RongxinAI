/**
 * Scheduled task (automation) preload surface, split from `../electron.d.ts`.
 */
export interface ScheduledTasksApi {
  list: () => Promise<{
    success: boolean;
    tasks?: import('../../../scheduledTask/types').ScheduledTask[];
    error?: string;
  }>;
  get: (id: string) => Promise<{
    success: boolean;
    task?: import('../../../scheduledTask/types').ScheduledTask;
    error?: string;
  }>;
  create: (input: import('../../../scheduledTask/types').ScheduledTaskInput) => Promise<{
    success: boolean;
    task?: import('../../../scheduledTask/types').ScheduledTask;
    error?: string;
  }>;
  update: (
    id: string,
    input: Partial<import('../../../scheduledTask/types').ScheduledTaskInput>,
  ) => Promise<{
    success: boolean;
    task?: import('../../../scheduledTask/types').ScheduledTask;
    error?: string;
  }>;
  delete: (id: string) => Promise<{ success: boolean; error?: string }>;
  toggle: (
    id: string,
    enabled: boolean,
  ) => Promise<{
    success: boolean;
    task?: import('../../../scheduledTask/types').ScheduledTask;
    warning?: string;
    error?: string;
  }>;
  runManually: (id: string) => Promise<{ success: boolean; error?: string }>;
  stop: (id: string) => Promise<{ success: boolean; error?: string }>;
  preflight: (id: string) => Promise<{
    success: boolean;
    error?: string;
    preflight?: {
      hasChannel: boolean;
      channel?: string;
      latestDelivery?: import('../../../scheduledTask/types').ScheduledTaskDeliveryRecord | null;
    };
  }>;
  listRuns: (
    taskId: string,
    limit?: number,
    offset?: number,
    filter?: import('../../../scheduledTask/types').RunFilter,
  ) => Promise<{
    success: boolean;
    runs?: import('../../../scheduledTask/types').ScheduledTaskRun[];
    error?: string;
  }>;
  listDeliveries: (runId: string) => Promise<{
    success: boolean;
    deliveries?: import('../../../scheduledTask/types').ScheduledTaskDeliveryRecord[];
    error?: string;
  }>;
  countRuns: (taskId: string) => Promise<{ success: boolean; count?: number; error?: string }>;
  listAllRuns: (
    limit?: number,
    offset?: number,
    filter?: import('../../../scheduledTask/types').RunFilter,
  ) => Promise<{
    success: boolean;
    runs?: import('../../../scheduledTask/types').ScheduledTaskRunWithName[];
    error?: string;
  }>;
  resolveSession: (sessionKey: string) => Promise<{
    success: boolean;
    session?: import('../cowork').CoworkSession | null;
    error?: string;
  }>;
  listChannels: () => Promise<{
    success: boolean;
    channels?: import('../../../scheduledTask/types').ScheduledTaskChannelOption[];
    error?: string;
  }>;
  listChannelConversations?: (
    channel: string,
    accountId?: string,
    filterAccountId?: string,
  ) => Promise<{
    success: boolean;
    conversations?: import('../../../scheduledTask/types').ScheduledTaskConversationOption[];
    error?: string;
  }>;
  onStatusUpdate: (
    callback: (data: import('../../../scheduledTask/types').ScheduledTaskStatusEvent) => void,
  ) => () => void;
  onRunUpdate: (
    callback: (data: import('../../../scheduledTask/types').ScheduledTaskRunEvent) => void,
  ) => () => void;
  onRefresh: (callback: () => void) => () => void;
}
