import type { ScheduledTask } from './types';

/** Transport-neutral scheduler boundary. ZhiYuan owns task and run records. */
export interface SchedulerRuntime {
  reconcile(tasks: readonly ScheduledTask[]): Promise<void>;
  register(task: ScheduledTask): Promise<void>;
  remove(taskId: string): Promise<void>;
  runNow(taskId: string): Promise<void>;
  handleTrigger(input: {
    accountId: string;
    taskId: string;
    scheduleVersion: string;
    scheduledAt: string;
  }): Promise<void>;
}
