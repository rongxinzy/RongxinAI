import { TaskStatus } from './constants';
import type { ActivityService } from '../main/activity/activityService';
import { LocalCronClock, type SchedulerClock } from './localCronClock';
import type { ScheduledTaskDeliveryDispatcher } from './deliveryDispatcher';
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

/** Owns the local clock, run claims and completion. */
export class SchedulerRuntime {
  private readonly shutdown = new AbortController();
  private readonly activeRuns = new Set<Promise<void>>();
  private readonly clock: SchedulerClock;

  constructor(
    private readonly store: SqliteScheduledTaskStore,
    clock: SchedulerClock | undefined,
    private readonly execute: (
      task: ScheduledTask,
      run: ScheduledTaskRun,
      signal: AbortSignal,
    ) => Promise<{ sessionId?: string | null; output?: string | null }>,
    private readonly deliveryDispatcher?: ScheduledTaskDeliveryDispatcher,
    private readonly activityService?: ActivityService,
    private readonly events?: SchedulerEventSink,
  ) {
    this.clock =
      clock ??
      new LocalCronClock((task, scheduledAtMs) => {
        void this.handleTrigger({
          taskId: task.taskId,
          scheduleVersion: task.scheduleVersion,
          scheduledAt: new Date(scheduledAtMs).toISOString(),
        }).catch(error => console.error('[Scheduler] Clock trigger failed:', error));
      });
  }

  async stop(): Promise<void> {
    this.clock.stop();
    this.shutdown.abort();
    await Promise.allSettled(this.activeRuns);
  }

  async reconcile(tasks: readonly ScheduledTask[]): Promise<void> {
    await Promise.all(tasks.map(task => this.register(task)));
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

  async removeProjection(taskId: string): Promise<void> {
    this.clock.remove(taskId);
  }

  async runNow(taskId: string): Promise<void> {
    this.shutdown.signal.throwIfAborted();
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
    await this.runClaimedTask(task, run);
  }

  async handleTrigger(input: {
    taskId: string;
    scheduleVersion: string;
    scheduledAt: string;
  }): Promise<void> {
    if (this.shutdown.signal.aborted) return;
    const task = this.store.get(input.taskId);
    if (!task) return;
    const scheduledAtMs = Date.parse(input.scheduledAt);
    if (!Number.isFinite(scheduledAtMs)) return;
    const run = this.store.claimTrigger({
      ...input,
      scheduledAt: new Date(scheduledAtMs).toISOString(),
    });
    if (!run) return; // disabled/stale/duplicate triggers are intentionally harmless.
    await this.runClaimedTask(task, run);
  }

  private async runClaimedTask(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    const execution = this.executeAndFinish(task, run);
    this.activeRuns.add(execution);
    try {
      await execution;
    } finally {
      this.activeRuns.delete(execution);
    }
  }

  private async executeAndFinish(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    this.publishActivity(run);
    this.publishRun(run, task.name);
    try {
      const result = await this.execute(task, run, this.shutdown.signal);
      const completedRun = this.store.finishRun(run.id, {
        status: TaskStatus.Success,
        sessionId: result.sessionId ?? null,
        replyPreview: result.output,
      });
      this.publishRun(completedRun, task.name);
      this.publishActivity(completedRun);
      // Delivery is independently durable and best effort: a channel failure
      // must not turn a Pi-successful Run into an execution failure.
      try {
        await this.deliveryDispatcher?.dispatch(
          task,
          completedRun,
          result.output ?? null,
          this.shutdown.signal,
        );
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
      this.publishActivity(failedRun);
      throw error;
    }
  }

  private publishActivity(run: ScheduledTaskRun): void {
    try {
      this.activityService?.publishScheduledRun(run);
    } catch (error) {
      console.error(`[Scheduler] Failed to publish activity for run ${run.id}:`, error);
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
