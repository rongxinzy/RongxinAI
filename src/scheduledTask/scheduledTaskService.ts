import type { ScheduledTask, ScheduledTaskInput, ScheduledTaskRun, ScheduledTaskRunWithName } from './types';
import type { RunFilter } from './types';

/** Renderer-facing task service. Implementations must not make a runtime authoritative. */
export interface ScheduledTaskService {
  addJob(input: ScheduledTaskInput): Promise<ScheduledTask>;
  updateJob(id: string, input: Partial<ScheduledTaskInput>): Promise<ScheduledTask>;
  removeJob(id: string): Promise<void>;
  listJobs(): Promise<ScheduledTask[]>;
  getJob(id: string): Promise<ScheduledTask | null>;
  toggleJob(id: string, enabled: boolean): Promise<ScheduledTask>;
  runJob(id: string): Promise<void>;
  listRuns(taskId: string, limit?: number, offset?: number, filter?: RunFilter): Promise<ScheduledTaskRun[]>;
  countRuns(taskId: string): Promise<number>;
  listAllRuns(limit?: number, offset?: number, filter?: RunFilter): Promise<ScheduledTaskRunWithName[]>;
}
