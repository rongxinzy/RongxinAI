import { Cron } from 'croner';

import type { Schedule } from './types';

/** A task the clock owes triggers for; scheduleVersion guards stale timers. */
export interface ClockTask {
  taskId: string;
  scheduleVersion: string;
  schedule: Schedule;
}

/** In-process scheduler clock surface used by the scheduler runtime. */
export interface SchedulerClock {
  upsert(task: ClockTask): void;
  remove(taskId: string): void;
}

type Timer = Cron | ReturnType<typeof setTimeout>;

const stopTimer = (timer: Timer): void => {
  if (timer instanceof Cron) timer.stop();
  else clearTimeout(timer);
};

/**
 * Main-process croner clock (work package E). The sidecar is no longer the
 * scheduler: task timers live here, so a channel-account change restarting
 * the sidecar, a missing sidecar binary, or crash backoff can never stop a
 * purely local task from firing.
 *
 * Semantics (mirrors the renderer's nextRun computation so the displayed next
 * run and the actual trigger agree):
 * - `cron`: croner 5-part mode with the schedule's timezone (DST included) or
 *   machine-local time when unset.
 * - `every`: absolute-grid intervals anchored at `anchorMs` (defaulting to
 *   registration time), so drift never accumulates.
 * - `at`: one-shot at the given ISO time; a past time never fires.
 * - `staggerMs` (cron only): delays the emitted trigger by up to that much to
 *   de-synchronize tasks sharing a slot; the scheduledAt reported to the
 *   runtime is the actual fire moment.
 * - Missed triggers while the app is closed are NOT replayed — same policy as
 *   the previous in-memory sidecar clock; `recoverInterruptedRuns` at startup
 *   is what marks interrupted runs failed.
 */
export class LocalCronClock implements SchedulerClock {
  private readonly timers = new Map<string, Timer>();

  constructor(private readonly fire: (task: ClockTask, scheduledAtMs: number) => void) {}

  upsert(task: ClockTask): void {
    this.remove(task.taskId);
    const timer = this.schedule(task);
    if (timer) this.timers.set(task.taskId, timer);
  }

  remove(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (!timer) return;
    stopTimer(timer);
    this.timers.delete(taskId);
  }

  private schedule(task: ClockTask): Timer | null {
    const { schedule } = task;
    if (schedule.kind === 'at') {
      const atMs = Date.parse(schedule.at);
      if (!Number.isFinite(atMs) || atMs <= Date.now()) return null;
      return setTimeout(() => this.emit(task), atMs - Date.now());
    }
    if (schedule.kind === 'every') {
      const everyMs = schedule.everyMs;
      if (!Number.isFinite(everyMs) || everyMs <= 0) return null;
      const anchorMs =
        typeof schedule.anchorMs === 'number' &&
        Number.isFinite(schedule.anchorMs) &&
        schedule.anchorMs > 0
          ? schedule.anchorMs
          : Date.now();
      let nextMs = anchorMs + Math.ceil(Math.max(0, Date.now() - anchorMs) / everyMs) * everyMs;
      const tick = (): void => {
        this.emit(task);
        nextMs += everyMs;
        const timer = setTimeout(tick, Math.max(0, nextMs - Date.now()));
        const existing = this.timers.get(task.taskId);
        if (existing !== undefined) {
          stopTimer(existing);
          this.timers.set(task.taskId, timer);
        } else {
          clearTimeout(timer);
        }
      };
      return setTimeout(tick, Math.max(0, nextMs - Date.now()));
    }
    try {
      return new Cron(
        schedule.expr.trim(),
        { timezone: schedule.tz?.trim() || undefined, mode: '5-part' },
        () => this.emit(task),
      );
    } catch (error) {
      // An invalid expression must not take the app down; the renderer's
      // nextRun already reports "cannot fire" for the same input.
      console.error(`[SchedulerClock] invalid cron expression for task ${task.taskId}:`, error);
      return null;
    }
  }

  private emit(task: ClockTask): void {
    const staggerMs =
      task.schedule.kind === 'cron' && task.schedule.staggerMs && task.schedule.staggerMs > 0
        ? Math.min(task.schedule.staggerMs, 30_000)
        : 0;
    if (staggerMs === 0) {
      this.fire(task, Date.now());
      return;
    }
    setTimeout(() => this.fire(task, Date.now()), staggerMs);
  }
}
