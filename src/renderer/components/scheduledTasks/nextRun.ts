import { Cron } from 'croner';

import type { Schedule, ScheduleCron } from '../../../scheduledTask/types';

const reportedInvalidCron = new Set<string>();

/**
 * Derives the displayed "next run" moment from a task's schedule.
 *
 * The durable scheduler owns firing and never writes `state.nextRunAtMs`, so
 * the renderer computes the label it shows. Returns null when the schedule can
 * no longer fire: a past one-time schedule, an invalid expression, or an
 * unknown timezone identifier.
 */
export function computeNextRunAtMs(schedule: Schedule, fromMs: number): number | null {
  if (schedule.kind === 'at') {
    const at = Date.parse(schedule.at);
    return Number.isFinite(at) && at > fromMs ? at : null;
  }

  if (schedule.kind === 'every') {
    if (!Number.isFinite(schedule.everyMs) || schedule.everyMs <= 0) return null;
    const anchorMs =
      typeof schedule.anchorMs === 'number' && Number.isFinite(schedule.anchorMs)
        ? schedule.anchorMs
        : fromMs;
    const steps = Math.floor((fromMs - anchorMs) / schedule.everyMs) + 1;
    return anchorMs + steps * schedule.everyMs;
  }

  return computeNextCronRunAtMs(schedule, fromMs);
}

/**
 * Standard 5-field cron evaluated by croner: day-of-month and day-of-week
 * combine with OR when both are restricted, and the schedule follows its
 * timezone (DST included) or the machine's local time when none is set.
 */
function computeNextCronRunAtMs(schedule: ScheduleCron, fromMs: number): number | null {
  const timezone = schedule.tz?.trim() || undefined;
  try {
    const next = new Cron(schedule.expr.trim(), {
      timezone,
      mode: '5-part',
      paused: true,
    }).nextRun(new Date(fromMs));
    return next ? next.getTime() : null;
  } catch (error) {
    const key = `${schedule.expr}\u0000${timezone ?? ''}`;
    if (!reportedInvalidCron.has(key)) {
      reportedInvalidCron.add(key);
      console.warn(
        `[NextRun] cannot evaluate cron "${schedule.expr}" (${timezone ?? 'local'})`,
        error,
      );
    }
    return null;
  }
}
