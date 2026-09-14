import type { Schedule, ScheduleCron } from '../../../scheduledTask/types';

/**
 * A cron expression can point at most four years ahead (Feb 29 on the next
 * leap year), so an expression that never matches is detected within this
 * window instead of looping forever.
 */
const MAX_SEARCH_DAYS = 1466;

const timezoneFormatters = new Map<string, Intl.DateTimeFormat>();
const unknownTimezones = new Set<string>();

/**
 * Derives the displayed "next run" moment from a task's schedule.
 *
 * The durable scheduler owns firing and never writes `state.nextRunAtMs`, so
 * the renderer computes the label it shows. Returns null when the schedule can
 * no longer fire: a past one-time schedule, an unsupported expression, or an
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

function computeNextCronRunAtMs(schedule: ScheduleCron, fromMs: number): number | null {
  const parts = schedule.expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteField, hourField, domField, monthField, dowField] = parts;

  const minutes = expandCronField(minuteField, 0, 59);
  const hours = expandCronField(hourField, 0, 23);
  const months = expandCronField(monthField, 1, 12);
  const daysOfMonth = expandCronField(domField, 1, 31);
  // Day-of-week accepts 0-7 with both 0 and 7 meaning Sunday.
  const parsedDaysOfWeek = expandCronField(dowField, 0, 7);
  if (!minutes || !hours || !months || !daysOfMonth || !parsedDaysOfWeek) return null;
  const daysOfWeek = parsedDaysOfWeek.map(day => (day === 7 ? 0 : day));

  const offsetMs = offsetFromUtcMs(schedule.tz, fromMs);
  if (offsetMs === null) return null;

  // Cron fields describe a wall clock, so search on the instant shifted by the
  // schedule's UTC offset and read the shifted instant through UTC getters.
  const wallClockNow = new Date(fromMs + offsetMs);
  const year = wallClockNow.getUTCFullYear();
  const month = wallClockNow.getUTCMonth();
  const day = wallClockNow.getUTCDate();
  const domRestricted = !isAnyField(domField);
  const dowRestricted = !isAnyField(dowField);

  for (let dayOffset = 0; dayOffset <= MAX_SEARCH_DAYS; dayOffset += 1) {
    const candidateDay = new Date(Date.UTC(year, month, day + dayOffset));
    if (!months.includes(candidateDay.getUTCMonth() + 1)) continue;
    const domMatches = daysOfMonth.includes(candidateDay.getUTCDate());
    const dowMatches = daysOfWeek.includes(candidateDay.getUTCDay());
    // Standard cron semantics: when both day fields are restricted, either
    // one matching is enough.
    const dayMatches = domRestricted
      ? dowRestricted
        ? domMatches || dowMatches
        : domMatches
      : dowRestricted
        ? dowMatches
        : true;
    if (!dayMatches) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = Date.UTC(year, month, day + dayOffset, hour, minute, 0, 0);
        if (candidate <= fromMs + offsetMs) continue;
        return candidate - offsetMs;
      }
    }
  }

  return null;
}

function isAnyField(field: string): boolean {
  return field === '*' || field === '?';
}

/**
 * Expands one cron field into every value it matches. `*` expands to the whole
 * range. Returns null for syntax this renderer cannot evaluate, so the caller
 * shows no next-run label instead of a wrong one.
 */
function expandCronField(field: string, min: number, max: number): number[] | null {
  if (isAnyField(field)) return rangeOf(min, max);
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const [rangeText, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step <= 0) return null;
    let from: number;
    let to: number;
    if (rangeText === '*') {
      from = min;
      to = max;
    } else {
      const bounds = rangeText.split('-');
      from = Number(bounds[0]);
      to = bounds.length > 1 ? Number(bounds[1]) : Number(bounds[0]);
      if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
    }
    if (from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values.size > 0 ? [...values].sort((a, b) => a - b) : null;
}

function rangeOf(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

/**
 * UTC offset applied to `atMs` when reading its wall clock, or null when the
 * timezone identifier is unknown. Without a timezone the schedule follows the
 * machine's local time.
 */
function offsetFromUtcMs(timeZone: string | undefined, atMs: number): number | null {
  const zone = timeZone?.trim();
  if (!zone) return -new Date(atMs).getTimezoneOffset() * 60_000;
  try {
    let formatter = timezoneFormatters.get(zone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      timezoneFormatters.set(zone, formatter);
    }
    const parts = formatter.formatToParts(new Date(atMs));
    const valueOf = (type: string) => Number(parts.find(part => part.type === type)?.value);
    const asUtc = Date.UTC(
      valueOf('year'),
      valueOf('month') - 1,
      valueOf('day'),
      valueOf('hour'),
      valueOf('minute'),
      valueOf('second'),
    );
    // formatToParts drops milliseconds, so compare against the floored instant.
    return asUtc - Math.floor(atMs / 1000) * 1000;
  } catch {
    if (!unknownTimezones.has(zone)) {
      unknownTimezones.add(zone);
      console.warn(`[NextRun] unknown timezone ${zone}, no next-run label`);
    }
    return null;
  }
}
