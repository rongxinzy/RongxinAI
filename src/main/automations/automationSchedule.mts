import { createHash } from 'node:crypto';
import { Cron } from 'croner';
import { ScheduleKind } from '../../scheduledTask/constants.js';
import type { Schedule } from '../../scheduledTask/types.js';

/** Cron is a calendar calculator here. Only Durable owns a timer. */
export function nextAutomationTime(schedule: Schedule, after: number, id: string): number | null {
  if (schedule.kind === ScheduleKind.At) {
    const at = Date.parse(schedule.at);
    return Number.isFinite(at) && at > after ? at : null;
  }
  if (schedule.kind === ScheduleKind.Every) {
    const anchor = schedule.anchorMs ?? after;
    return after < anchor
      ? anchor
      : anchor + (Math.floor((after - anchor) / schedule.everyMs) + 1) * schedule.everyMs;
  }
  const cron = new Cron(schedule.expr, {
    paused: true,
    timezone: schedule.tz?.trim() || undefined,
    mode: '5-part',
  });
  try {
    const next = cron.nextRun(new Date(after));
    if (!next) return null;
    const stagger = Math.min(30_000, Math.max(0, schedule.staggerMs ?? 0));
    const seed = createHash('sha256').update(`${id}:${next.getTime()}`).digest().readUInt32BE(0);
    return next.getTime() + (stagger ? seed % (stagger + 1) : 0);
  } finally {
    cron.stop();
  }
}

export function normalizeAutomationSchedule(schedule: Schedule, now: number): Schedule {
  if (schedule.kind === ScheduleKind.At) {
    if (
      !Number.isFinite(Date.parse(schedule.at)) ||
      !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(schedule.at)
    )
      throw new Error('Invalid one-time timestamp.');
    return { kind: ScheduleKind.At, at: new Date(schedule.at).toISOString() };
  }
  if (schedule.kind === ScheduleKind.Every) {
    if (!Number.isSafeInteger(schedule.everyMs) || schedule.everyMs < 1)
      throw new Error('The interval must be a positive integer in milliseconds.');
    if (
      schedule.anchorMs !== undefined &&
      (!Number.isSafeInteger(schedule.anchorMs) || Math.abs(schedule.anchorMs) > 8.64e15)
    )
      throw new Error('Invalid interval anchor.');
    return {
      kind: ScheduleKind.Every,
      everyMs: schedule.everyMs,
      anchorMs: schedule.anchorMs ?? now,
    };
  }
  if (schedule.kind !== ScheduleKind.Cron || schedule.expr.trim().split(/\s+/).length !== 5)
    throw new Error('The cron expression must contain five fields.');
  if (schedule.staggerMs !== undefined && !Number.isFinite(schedule.staggerMs))
    throw new Error('Invalid cron stagger.');
  const result: Schedule = {
    kind: ScheduleKind.Cron,
    expr: schedule.expr.trim(),
    ...(schedule.tz?.trim() ? { tz: schedule.tz.trim() } : {}),
    ...(schedule.staggerMs ? { staggerMs: Math.min(30_000, Math.max(0, schedule.staggerMs)) } : {}),
  };
  if (nextAutomationTime(result, now, 'validate') === null)
    throw new Error('The cron calendar has no future occurrence.');
  return result;
}
