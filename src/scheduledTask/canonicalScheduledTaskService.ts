import type { SchedulerRuntime } from './schedulerRuntime';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';
import type { ScheduledTaskService } from './scheduledTaskService';
import type {
  ScheduledTask,
  ScheduledTaskDeliveryRecord,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTaskRunWithName,
  RunFilter,
} from './types';

/** SQLite-backed scheduled tasks and their local clock projections. */
export class CanonicalScheduledTaskService implements ScheduledTaskService {
  constructor(
    private readonly store: SqliteScheduledTaskStore,
    private readonly runtime: SchedulerRuntime,
  ) {}

  armSavedSchedules(): Promise<void> {
    return this.runtime.reconcile(this.store.list());
  }

  stop(): Promise<void> {
    return this.runtime.stop();
  }

  async addJob(input: ScheduledTaskInput): Promise<ScheduledTask> {
    const task = this.store.create(input);
    await this.projectBestEffort(task);
    return task;
  }
  async updateJob(id: string, input: Partial<ScheduledTaskInput>): Promise<ScheduledTask> {
    const task = this.store.update(id, input);
    await this.projectBestEffort(task);
    return task;
  }
  async removeJob(id: string): Promise<void> {
    this.store.remove(id);
    try {
      await this.runtime.removeProjection(id);
    } catch (error) {
      console.warn(`[Scheduler] failed to remove disposable projection for task ${id}:`, error);
    }
  }
  async listJobs(): Promise<ScheduledTask[]> {
    return this.store.list();
  }
  async getJob(id: string): Promise<ScheduledTask | null> {
    return this.store.get(id);
  }
  async toggleJob(id: string, enabled: boolean): Promise<ScheduledTask> {
    return this.updateJob(id, { enabled });
  }
  async runJob(id: string): Promise<void> {
    await this.runtime.runNow(id);
  }
  async listRuns(
    taskId: string,
    limit = 20,
    offset = 0,
    filter?: RunFilter,
  ): Promise<ScheduledTaskRun[]> {
    return this.store.listRuns(taskId, limit, offset, filter);
  }
  async listDeliveries(runId: string): Promise<ScheduledTaskDeliveryRecord[]> {
    return this.store.listDeliveries(runId);
  }
  async listAllRuns(
    limit = 20,
    offset = 0,
    filter?: RunFilter,
  ): Promise<ScheduledTaskRunWithName[]> {
    return this.store.listRunsWithName(limit, offset, filter);
  }

  private async projectBestEffort(task: ScheduledTask): Promise<void> {
    try {
      await this.runtime.register(task);
    } catch (error) {
      console.warn(`[Scheduler] failed to project local schedule for task ${task.id}:`, error);
    }
  }
}
