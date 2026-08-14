import { TaskStatus } from './constants';
import { ActivitySource, ActivityStatus } from '../shared/activity/constants';
import type { ActivityService } from '../main/activity/activityService';
import { SchedulerClockAccount, type CcConnectCronTask } from './ccConnectCronClient';
import type { ScheduledTaskDeliveryDispatcher } from './deliveryDispatcher';
import type { SchedulerRuntime } from './schedulerRuntime';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';
import type { ScheduledTask, ScheduledTaskRun } from './types';

type TriggerClient = {
  upsert(task: CcConnectCronTask): Promise<void>;
  remove(task: Pick<CcConnectCronTask, 'accountId' | 'taskId'>): Promise<void>;
};

/**
 * The only scheduler runtime allowed for cc-connect. It persists and claims
 * work locally; the sidecar is a disposable clock that can only emit triggers.
 */
export class CcConnectSchedulerRuntime implements SchedulerRuntime {
  constructor(
    private readonly store: SqliteScheduledTaskStore,
    private readonly client: TriggerClient,
    private readonly execute: (task: ScheduledTask, run: ScheduledTaskRun) => Promise<{ sessionId?: string | null; output?: string | null }>,
    private readonly deliveryDispatcher?: ScheduledTaskDeliveryDispatcher,
    private readonly activityService?: ActivityService,
  ) {}

  async reconcile(tasks: readonly ScheduledTask[]): Promise<void> {
    for (const task of tasks) await this.register(task);
  }

  async register(task: ScheduledTask): Promise<void> {
    if (!task.enabled) {
      await this.removeProjectionTask(task);
      return;
    }
    const scheduleVersion = task.scheduleVersion;
    if (!scheduleVersion) throw new Error(`Scheduled task ${task.id} has no scheduleVersion`);
    await this.client.upsert({ accountId: SchedulerClockAccount, taskId: task.id, scheduleVersion, schedule: task.schedule });
  }

  async remove(taskId: string): Promise<void> {
    const task = this.store.get(taskId);
    if (task) await this.removeProjectionTask(task);
  }

  async removeProjection(taskId: string): Promise<void> {
    try {
      await this.client.remove({ accountId: SchedulerClockAccount, taskId });
    } catch (error) {
      if (!String(error).includes('HTTP 404')) throw error;
    }
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

  async handleTrigger(input: { accountId: string; taskId: string; scheduleVersion: string; scheduledAt: string }): Promise<void> {
    const task = this.store.get(input.taskId);
    if (!task || input.accountId !== SchedulerClockAccount) return;
    const scheduledAtMs = Date.parse(input.scheduledAt);
    if (!Number.isFinite(scheduledAtMs)) return;
    const run = this.store.claimTrigger({ ...input, scheduledAt: new Date(scheduledAtMs).toISOString() });
    if (!run) return; // disabled/stale/duplicate triggers are intentionally harmless.
    await this.executeAndFinish(task, run);
  }

  private async executeAndFinish(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    this.activityService?.upsertBestEffort({ id: run.id, source: ActivitySource.ScheduledTask, status: ActivityStatus.Running, startedAt: Date.parse(run.startedAt), taskName: task.name, inputPreview: task.payload.kind === 'agentTurn' ? task.payload.message : task.payload.text });
    try {
      const result = await this.execute(task, run);
      const completedRun = this.store.finishRun(run.id, { status: TaskStatus.Success, sessionId: result.sessionId ?? null });
      this.activityService?.upsertBestEffort({ id: run.id, source: ActivitySource.ScheduledTask, status: ActivityStatus.Completed, taskName: task.name, sessionId: result.sessionId ?? undefined, replyPreview: result.output ?? undefined });
      // Delivery is independently durable and best effort: a channel failure
      // must not turn a Pi-successful Run into an execution failure.
      try {
        await this.deliveryDispatcher?.dispatch(task, completedRun, result.output ?? null);
      } catch (error) {
        console.error(`[Scheduler] Failed to persist Delivery for run ${run.id}:`, error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.finishRun(run.id, {
        status: TaskStatus.Error,
        error: message,
      });
      this.activityService?.upsertBestEffort({ id: run.id, source: ActivitySource.ScheduledTask, status: ActivityStatus.Failed, taskName: task.name, errorMessage: message });
      throw error;
    }
  }

  private async removeProjectionTask(task: ScheduledTask): Promise<void> {
    try { await this.client.remove({ accountId: SchedulerClockAccount, taskId: task.id }); }
    catch (error) {
      // A restarted sidecar has no in-memory registration; its 404 is already
      // the desired state and must not prevent the canonical mutation.
      if (!String(error).includes('HTTP 404')) throw error;
    }
  }
}
