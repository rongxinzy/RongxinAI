import { TaskStatus } from './constants';
import { ActivitySource, ActivityStatus } from '../shared/activity/constants';
import type { ActivityService } from '../main/activity/activityService';
import type { SchedulerClock } from './localCronClock';
import type { ScheduledTaskDeliveryDispatcher } from './deliveryDispatcher';
import type { SchedulerRuntime } from './schedulerRuntime';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';
import type { ScheduledTask, ScheduledTaskRun, TaskState } from './types';

/**
 * Renderer-facing projection of canonical Run/state changes. The scheduler
 * never polls, so every transition it makes must be pushed.
 */
export interface SchedulerEventSink {
  runUpdated(run: ScheduledTaskRun, taskName: string): void;
  taskStateChanged(taskId: string, state: TaskState): void;
}

/**
 * The only scheduler runtime. It persists and claims work locally and owns an
 * in-process croner clock (work package E): no sidecar round-trip, no virtual
 * clock account — a channel-account change or a missing sidecar cannot stop a
 * local task from firing.
 */
export class CcConnectSchedulerRuntime implements SchedulerRuntime {
  constructor(
    private readonly store: SqliteScheduledTaskStore,
    private readonly clock: SchedulerClock,
    private readonly execute: (
      task: ScheduledTask,
      run: ScheduledTaskRun,
    ) => Promise<{ sessionId?: string | null; output?: string | null }>,
    private readonly deliveryDispatcher?: ScheduledTaskDeliveryDispatcher,
    private readonly activityService?: ActivityService,
    private readonly events?: SchedulerEventSink,
  ) {}

  async reconcile(tasks: readonly ScheduledTask[]): Promise<void> {
    for (const task of tasks) await this.register(task);
  }

  async register(task: ScheduledTask): Promise<void> {
    if (!task.enabled) {
      this.clock.remove(task.id);
      return;
    }
    const scheduleVersion = task.scheduleVersion;
    if (!scheduleVersion) throw new Error(`Scheduled task ${task.id} has no scheduleVersion`);
    this.clock.upsert({
      taskId: task.id,
      scheduleVersion,
      schedule: task.schedule,
    });
  }

  async remove(taskId: string): Promise<void> {
    const task = this.store.get(taskId);
    if (task) this.clock.remove(taskId);
  }

  async removeProjection(taskId: string): Promise<void> {
    this.clock.remove(taskId);
  }

  async runNow(taskId: string): Promise<void> {
    const task = this.store.get(taskId);
    if (!task) throw new Error(`Scheduled task not found: ${taskId}`);
    const run = this.store.claimTrigger(
      {
        taskId,
        scheduleVersion: task.scheduleVersion ?? '',
        // Manual invocations need a fresh identity while keeping the same canonical path.
        scheduledAt: `${new Date().toISOString()}:manual:${crypto.randomUUID()}`,
      },
      // A paused task may still be run once by hand from the task list.
      { allowDisabled: true },
    );
    if (!run) throw new Error(`Unable to claim scheduled task: ${taskId}`);
    await this.executeAndFinish(task, run);
  }

  async handleTrigger(input: {
    taskId: string;
    scheduleVersion: string;
    scheduledAt: string;
  }): Promise<void> {
    const task = this.store.get(input.taskId);
    if (!task) return;
    const scheduledAtMs = Date.parse(input.scheduledAt);
    if (!Number.isFinite(scheduledAtMs)) return;
    const run = this.store.claimTrigger({
      ...input,
      scheduledAt: new Date(scheduledAtMs).toISOString(),
    });
    if (!run) return; // disabled/stale/duplicate triggers are intentionally harmless.
    await this.executeAndFinish(task, run);
  }

  private async executeAndFinish(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    this.activityService?.upsertBestEffort({
      id: run.id,
      source: ActivitySource.ScheduledTask,
      status: ActivityStatus.Running,
      startedAt: Date.parse(run.startedAt),
      taskName: task.name,
      inputPreview: task.payload.kind === 'agentTurn' ? task.payload.message : task.payload.text,
    });
    this.publishRun(run, task.name);
    try {
      const result = await this.execute(task, run);
      const completedRun = this.store.finishRun(run.id, {
        status: TaskStatus.Success,
        sessionId: result.sessionId ?? null,
      });
      this.publishRun(completedRun, task.name);
      this.activityService?.upsertBestEffort({
        id: run.id,
        source: ActivitySource.ScheduledTask,
        status: ActivityStatus.Completed,
        taskName: task.name,
        sessionId: result.sessionId ?? undefined,
        replyPreview: result.output ?? undefined,
      });
      // Delivery is independently durable and best effort: a channel failure
      // must not turn a Pi-successful Run into an execution failure.
      try {
        await this.deliveryDispatcher?.dispatch(task, completedRun, result.output ?? null);
      } catch (error) {
        console.error(`[Scheduler] Failed to persist Delivery for run ${run.id}:`, error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedRun = this.store.finishRun(run.id, {
        status: TaskStatus.Error,
        error: message,
      });
      this.publishRun(failedRun, task.name);
      this.activityService?.upsertBestEffort({
        id: run.id,
        source: ActivitySource.ScheduledTask,
        status: ActivityStatus.Failed,
        taskName: task.name,
        errorMessage: message,
      });
      throw error;
    }
  }

  /** Pushes the Run and the task state it produced; renderer staleness is a bug. */
  private publishRun(run: ScheduledTaskRun, taskName: string): void {
    if (!this.events) return;
    try {
      this.events.runUpdated(run, taskName);
      const state = this.store.get(run.taskId)?.state;
      if (state) this.events.taskStateChanged(run.taskId, state);
    } catch (error) {
      console.warn(`[Scheduler] failed to publish run ${run.id} to the renderer:`, error);
    }
  }
}
