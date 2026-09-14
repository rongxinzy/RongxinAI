import { CcConnectSchedulerRuntime } from './ccConnectSchedulerRuntime';
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

/** SQLite-backed user-facing service. cc-connect remains only a trigger projection. */
export class CanonicalScheduledTaskService implements ScheduledTaskService {
  constructor(
    private readonly store: SqliteScheduledTaskStore,
    private readonly runtime: CcConnectSchedulerRuntime,
  ) {}

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
    return filterRuns(this.store.listRuns(taskId), filter).slice(offset, offset + limit);
  }
  async listDeliveries(runId: string): Promise<ScheduledTaskDeliveryRecord[]> {
    return this.store.listDeliveries(runId);
  }
  async countRuns(taskId: string): Promise<number> {
    return this.store.listRuns(taskId).length;
  }
  async listAllRuns(
    limit = 20,
    offset = 0,
    filter?: RunFilter,
  ): Promise<ScheduledTaskRunWithName[]> {
    return filterRuns(this.store.listRunsWithName(), filter).slice(offset, offset + limit);
  }
  getJobNameSync(jobId: string): string | null {
    return this.store.get(jobId)?.name ?? null;
  }
  hasRunningJobs(): boolean {
    return this.store.list().some(task => task.state.runningAtMs !== null);
  }
  /** State is pushed by the sidecar; no runtime polling is needed. */
  startPolling(): void {}
  stopPolling(): void {}

  private async projectBestEffort(task: ScheduledTask): Promise<void> {
    try {
      await this.runtime.register(task);
    } catch (error) {
      console.warn(
        `[Scheduler] canonical task ${task.id} is waiting for sidecar reconciliation:`,
        error,
      );
    }
  }
}

function filterRuns<T extends ScheduledTaskRun>(runs: readonly T[], filter?: RunFilter): T[] {
  // Run timestamps are stored in UTC but rendered in local time, so the
  // calendar-day bounds must be local days too: `2026-09-14` means local
  // midnight through local 23:59:59.999, not the UTC day.
  const startMs = filter?.startDate ? Date.parse(`${filter.startDate}T00:00:00`) : NaN;
  const endMs = filter?.endDate ? Date.parse(`${filter.endDate}T23:59:59.999`) : NaN;
  return runs.filter(run => {
    if (filter?.status && run.status !== filter.status) return false;
    if (!Number.isFinite(startMs) && !Number.isFinite(endMs)) return true;
    const startedMs = Date.parse(run.startedAt);
    if (!Number.isFinite(startedMs)) return false;
    if (Number.isFinite(startMs) && startedMs < startMs) return false;
    if (Number.isFinite(endMs) && startedMs > endMs) return false;
    return true;
  });
}
