import { TaskStatus } from './constants';
import type { CcConnectCronTask } from './ccConnectCronClient';
import type { SchedulerRuntime } from './schedulerRuntime';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';
import type { ScheduledTask, ScheduledTaskRun } from './types';

type TriggerClient = {
  upsert(task: CcConnectCronTask): Promise<void>;
  remove(taskId: string): Promise<void>;
};

/**
 * The only scheduler runtime allowed for cc-connect. It persists and claims
 * work locally; the sidecar is a disposable clock that can only emit triggers.
 */
export class CcConnectSchedulerRuntime implements SchedulerRuntime {
  constructor(
    private readonly store: SqliteScheduledTaskStore,
    private readonly client: TriggerClient,
    private readonly execute: (task: ScheduledTask, run: ScheduledTaskRun) => Promise<{ sessionId?: string | null }>,
  ) {}

  async reconcile(tasks: readonly ScheduledTask[]): Promise<void> {
    for (const task of tasks) await this.register(task);
  }

  async register(task: ScheduledTask): Promise<void> {
    if (!task.enabled) {
      await this.removeProjection(task.id);
      return;
    }
    const scheduleVersion = task.scheduleVersion;
    if (!scheduleVersion) throw new Error(`Scheduled task ${task.id} has no scheduleVersion`);
    await this.client.upsert({ taskId: task.id, scheduleVersion, schedule: task.schedule });
  }

  async remove(taskId: string): Promise<void> {
    await this.removeProjection(taskId);
  }

  async runNow(taskId: string): Promise<void> {
    const task = this.store.get(taskId);
    if (!task) throw new Error(`Scheduled task not found: ${taskId}`);
    const run = this.store.claimTrigger({
      taskId, scheduleVersion: task.scheduleVersion ?? '',
      // Manual invocations need a fresh identity while keeping the same canonical path.
      scheduledAt: `${new Date().toISOString()}:manual:${crypto.randomUUID()}`,
    });
    if (!run) throw new Error(`Unable to claim scheduled task: ${taskId}`);
    await this.executeAndFinish(task, run);
  }

  async handleTrigger(input: { taskId: string; scheduleVersion: string; scheduledAt: string }): Promise<void> {
    const run = this.store.claimTrigger(input);
    if (!run) return; // disabled/stale/duplicate triggers are intentionally harmless.
    const task = this.store.get(input.taskId);
    if (!task) return;
    await this.executeAndFinish(task, run);
  }

  private async executeAndFinish(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    try {
      const result = await this.execute(task, run);
      this.store.finishRun(run.id, { status: TaskStatus.Success, sessionId: result.sessionId ?? null });
    } catch (error) {
      this.store.finishRun(run.id, {
        status: TaskStatus.Error,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async removeProjection(taskId: string): Promise<void> {
    try { await this.client.remove(taskId); }
    catch (error) {
      // A restarted sidecar has no in-memory registration; its 404 is already
      // the desired state and must not prevent the canonical mutation.
      if (!String(error).includes('HTTP 404')) throw error;
    }
  }
}
