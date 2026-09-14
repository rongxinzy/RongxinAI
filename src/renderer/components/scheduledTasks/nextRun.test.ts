import { expect, test } from 'vitest';

import { computeNextRunAtMs } from './nextRun';

test('returns the moment of a future one-time schedule and nothing once it passed', () => {
  const from = new Date(2026, 8, 14, 10, 0, 0).getTime();
  const at = new Date(2026, 8, 14, 11, 30, 0);
  expect(computeNextRunAtMs({ kind: 'at', at: at.toISOString() }, from)).toBe(at.getTime());
  expect(computeNextRunAtMs({ kind: 'at', at: new Date(from - 1).toISOString() }, from)).toBeNull();
});

test('schedules an interval from its anchor, and from now without one', () => {
  const anchorMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  const fromMs = anchorMs + 61_000;
  expect(computeNextRunAtMs({ kind: 'every', everyMs: 60_000, anchorMs }, fromMs)).toBe(
    anchorMs + 120_000,
  );
  expect(computeNextRunAtMs({ kind: 'every', everyMs: 60_000 }, fromMs)).toBe(fromMs + 60_000);
  expect(computeNextRunAtMs({ kind: 'every', everyMs: 0 }, fromMs)).toBeNull();
});

test('finds the next daily cron instance in local time', () => {
  const from = new Date(2026, 8, 14, 10, 29, 0).getTime();
  expect(computeNextRunAtMs({ kind: 'cron', expr: '30 10 * * *' }, from)).toBe(
    new Date(2026, 8, 14, 10, 30, 0).getTime(),
  );
  expect(computeNextRunAtMs({ kind: 'cron', expr: '0 9 * * *' }, from)).toBe(
    new Date(2026, 8, 15, 9, 0, 0).getTime(),
  );
});

test('supports step and list fields', () => {
  const from = new Date(2026, 8, 14, 10, 7, 0).getTime();
  expect(computeNextRunAtMs({ kind: 'cron', expr: '*/15 * * * *' }, from)).toBe(
    new Date(2026, 8, 14, 10, 15, 0).getTime(),
  );
  expect(computeNextRunAtMs({ kind: 'cron', expr: '0 8,20 * * *' }, from)).toBe(
    new Date(2026, 8, 14, 20, 0, 0).getTime(),
  );
});

test('skips days the weekday field excludes', () => {
  const from = new Date(2026, 8, 14, 10, 0, 0).getTime();
  const next = computeNextRunAtMs({ kind: 'cron', expr: '0 9 * * 1-5' }, from);
  expect(next).not.toBeNull();
  const nextDate = new Date(next as number);
  expect(nextDate.getDay()).toBeGreaterThanOrEqual(1);
  expect(nextDate.getDay()).toBeLessThanOrEqual(5);
  expect(nextDate.getHours()).toBe(9);
});

test('matches either day field when both are restricted', () => {
  const from = new Date(2026, 8, 14, 0, 0, 0).getTime();
  const next = computeNextRunAtMs({ kind: 'cron', expr: '0 0 1 * 5' }, from);
  expect(next).not.toBeNull();
  const nextDate = new Date(next as number);
  expect(nextDate.getDay()).toBe(5);
  expect(nextDate.getTime()).toBeLessThan(new Date(2026, 9, 1, 0, 0, 0).getTime());
});

test('honours the configured timezone', () => {
  const from = Date.UTC(2026, 8, 14, 0, 0, 0);
  expect(computeNextRunAtMs({ kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' }, from)).toBe(
    Date.UTC(2026, 8, 14, 1, 0, 0),
  );
});

test('finds a leap-day schedule inside the search window', () => {
  const from = new Date(2026, 8, 14, 0, 0, 0).getTime();
  expect(computeNextRunAtMs({ kind: 'cron', expr: '0 0 29 2 *' }, from)).toBe(
    new Date(2028, 1, 29, 0, 0, 0).getTime(),
  );
});

test('returns null instead of guessing for unevaluable schedules', () => {
  const from = new Date(2026, 8, 14, 0, 0, 0).getTime();
  expect(computeNextRunAtMs({ kind: 'cron', expr: '0 9 * *' }, from)).toBeNull();
  expect(computeNextRunAtMs({ kind: 'cron', expr: 'bad 9 * * *' }, from)).toBeNull();
  expect(computeNextRunAtMs({ kind: 'cron', expr: '0 9 32 * *' }, from)).toBeNull();
  expect(
    computeNextRunAtMs({ kind: 'cron', expr: '0 9 * * *', tz: 'Not/AZone' }, from),
  ).toBeNull();
});
