import { afterEach, expect, test, vi } from 'vitest';

import { LocalCronClock, type ClockTask } from './localCronClock';

afterEach(() => {
  vi.useRealTimers();
});

const useScheduledClock = () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const fired: Array<{ taskId: string; scheduledAtMs: number }> = [];
  const clock = new LocalCronClock((task, scheduledAtMs) => {
    fired.push({ taskId: task.taskId, scheduledAtMs });
  });
  return { clock, fired };
};

const task = (overrides: Partial<ClockTask> = {}): ClockTask => ({
  taskId: 'task-1',
  scheduleVersion: 'v1',
  schedule: { kind: 'cron', expr: '0 9 * * *' },
  ...overrides,
});

test('a cron schedule fires at the wall-clock time of its timezone, DST included', () => {
  vi.setSystemTime(Date.parse('2026-10-31T08:00:00Z')); // Sat 08:00 UTC
  const { clock, fired } = useScheduledClock();
  clock.upsert(task({ schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'America/New_York' } }));

  // Oct 31 09:00 New York is EDT (UTC-4) -> 13:00 UTC.
  vi.advanceTimersByTime(5 * 60 * 60 * 1000);
  expect(fired.map(entry => entry.scheduledAtMs)).toEqual([Date.parse('2026-10-31T13:00:00.000Z')]);

  // Nov 1 09:00 New York is EST (UTC-5, after the fallback) -> 14:00 UTC. The
  // display next-run and the actual trigger agree because both use croner.
  // (26 h from 13:00 UTC: the fallback day is 25 wall-clock hours long.)
  vi.advanceTimersByTime(26 * 60 * 60 * 1000);
  expect(fired.map(entry => entry.scheduledAtMs)).toEqual([
    Date.parse('2026-10-31T13:00:00.000Z'),
    Date.parse('2026-11-01T14:00:00.000Z'),
  ]);
});

test('an "at" schedule fires once in the future and never for a past time', () => {
  vi.setSystemTime(Date.parse('2026-10-31T00:00:00Z'));
  const { clock, fired } = useScheduledClock();

  clock.upsert(task({ schedule: { kind: 'at', at: '2026-10-31T02:00:00Z' } }));
  clock.upsert(
    task({
      taskId: 'past',
      scheduleVersion: 'v1',
      schedule: { kind: 'at', at: '2026-10-30T00:00:00Z' },
    }),
  );

  vi.advanceTimersByTime(24 * 60 * 60 * 1000);
  expect(fired.map(entry => entry.taskId)).toEqual(['task-1']);
});

test('an "every" schedule stays on the absolute anchor grid (no drift, no catch-up bursts)', () => {
  // The anchor is three periods in the past: missed slots while "the app was
  // closed" are not replayed — the first fire lands on the NEXT grid point.
  vi.setSystemTime(Date.parse('2026-10-31T00:03:30Z'));
  const { clock, fired } = useScheduledClock();
  const anchorMs = Date.parse('2026-10-31T00:00:00Z');
  clock.upsert(task({ schedule: { kind: 'every', everyMs: 60_000, anchorMs } }));

  vi.advanceTimersByTime(30_000);
  expect(fired.map(entry => entry.scheduledAtMs)).toEqual([anchorMs + 4 * 60_000]);

  vi.advanceTimersByTime(60_000);
  expect(fired.map(entry => entry.scheduledAtMs)).toEqual([
    anchorMs + 4 * 60_000,
    anchorMs + 5 * 60_000,
  ]);
});

test('staggerMs delays the emitted trigger without changing the slot', () => {
  vi.setSystemTime(Date.parse('2026-10-31T08:59:00Z'));
  const { clock, fired } = useScheduledClock();
  clock.upsert(
    task({ schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'UTC', staggerMs: 5_000 } }),
  );

  vi.advanceTimersByTime(60_000); // slot reached (09:00) + stagger window open
  expect(fired).toHaveLength(0);
  vi.advanceTimersByTime(5_000);
  expect(fired).toHaveLength(1);
});

test('remove disarms the timer and an upsert replaces the previous schedule', () => {
  vi.setSystemTime(Date.parse('2026-10-31T08:00:00Z'));
  const { clock, fired } = useScheduledClock();
  clock.upsert(task({ schedule: { kind: 'at', at: '2026-10-31T09:00:00Z' } }));
  clock.upsert(task({ schedule: { kind: 'at', at: '2026-10-31T10:00:00Z' } }));
  clock.remove('task-1');

  vi.advanceTimersByTime(48 * 60 * 60 * 1000);
  expect(fired).toHaveLength(0);
});

test('an invalid cron expression logs instead of throwing and never fires', () => {
  vi.setSystemTime(Date.parse('2026-10-31T00:00:00Z'));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { clock, fired } = useScheduledClock();

  expect(() =>
    clock.upsert(task({ schedule: { kind: 'cron', expr: 'not a cron' } })),
  ).not.toThrow();
  vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000);
  expect(fired).toHaveLength(0);
  expect(error).toHaveBeenCalledOnce();
  error.mockRestore();
});
