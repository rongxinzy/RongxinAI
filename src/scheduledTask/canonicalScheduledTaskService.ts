import { CcConnectSchedulerRuntime } from './ccConnectSchedulerRuntime';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';
import type { ScheduledTaskService } from './scheduledTaskService';
import type { ScheduledTask, ScheduledTaskInput, ScheduledTaskRun, ScheduledTaskRunWithName, RunFilter } from './types';

/** SQLite-backed user-facing service. cc-connect remains only a trigger projection. */
export class CanonicalScheduledTaskService implements ScheduledTaskService {
  constructor(private readonly store: SqliteScheduledTaskStore, private readonly runtime: CcConnectSchedulerRuntime) {}

  async addJob(input: ScheduledTaskInput): Promise<ScheduledTask> {
    const task = this.store.create(input);
    try { await this.runtime.register(task); return task; }
    catch (error) { this.store.remove(task.id); throw error; }
  }
  async updateJob(id: string, input: Partial<ScheduledTaskInput>): Promise<ScheduledTask> {
    const previous = this.store.get(id);
    if (!previous) throw new Error(`Scheduled task not found: ${id}`);
    const task = this.store.update(id, input);
    try { await this.runtime.register(task); return task; }
    catch (error) { this.store.update(id, previous); throw error; }
  }
  async removeJob(id: string): Promise<void> {
    await this.runtime.remove(id);
    this.store.remove(id);
  }
  async listJobs(): Promise<ScheduledTask[]> { return this.store.list(); }
  async getJob(id: string): Promise<ScheduledTask | null> { return this.store.get(id); }
  async toggleJob(id: string, enabled: boolean): Promise<ScheduledTask> { return this.updateJob(id, { enabled }); }
  async runJob(id: string): Promise<void> { await this.runtime.runNow(id); }
  async listRuns(taskId: string, limit = 20, offset = 0, filter?: RunFilter): Promise<ScheduledTaskRun[]> {
    return filterRuns(this.store.listRuns(taskId), filter).slice(offset, offset + limit);
  }
  async countRuns(taskId: string): Promise<number> { return this.store.listRuns(taskId).length; }
  async listAllRuns(limit = 20, offset = 0, filter?: RunFilter): Promise<ScheduledTaskRunWithName[]> {
    return filterRuns(this.store.listRunsWithName(), filter).slice(offset, offset + limit);
  }
}

function filterRuns<T extends ScheduledTaskRun>(runs: readonly T[], filter?: RunFilter): T[] {
  return runs.filter(run => {
    if (filter?.status && run.status !== filter.status) return false;
    if (filter?.startDate && run.startedAt < `${filter.startDate}T00:00:00`) return false;
    if (filter?.endDate && run.startedAt > `${filter.endDate}T23:59:59.999Z`) return false;
    return true;
  });
}
