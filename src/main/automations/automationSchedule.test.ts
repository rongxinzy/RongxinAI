import { expect, test, vi } from 'vitest';
import { normalizeAutomationSchedule, nextAutomationTime } from './automationSchedule.mjs';

test('cron is calendar calculation only, including timezone and DST transitions', () => {
  const timer = vi.spyOn(globalThis, 'setTimeout');
  try {
    const now = Date.parse('2026-03-08T06:00:00Z');
    const schedule = normalizeAutomationSchedule(
      { kind: 'cron', expr: '30 3 * * *', tz: 'America/New_York' },
      now,
    );
    expect(nextAutomationTime(schedule, now, 'job')).toBe(Date.parse('2026-03-08T07:30:00Z'));
    expect(timer).not.toHaveBeenCalled();
  } finally {
    timer.mockRestore();
  }
});

test('intervals keep a stable anchor and collapse missed triggers into one future time', () => {
  const schedule = normalizeAutomationSchedule({ kind: 'every', everyMs: 1000 }, 100);
  expect(nextAutomationTime(schedule, 100, 'job')).toBe(1100);
  expect(nextAutomationTime(schedule, 4101, 'job')).toBe(5100);
  expect(
    nextAutomationTime({ kind: 'at', at: new Date(200).toISOString() }, 201, 'job'),
  ).toBeNull();
});

test('stagger is deterministic, bounded, and invalid calendars fail explicitly', () => {
  const after = Date.parse('2026-11-14T00:00:00Z');
  const base = { kind: 'cron' as const, expr: '* * * * *', tz: 'UTC', staggerMs: 30_000 };
  const first = nextAutomationTime(base, after, 'job');
  expect(first).toBe(nextAutomationTime(base, after, 'job'));
  expect(first).toBeGreaterThanOrEqual(after + 60_000);
  expect(first).toBeLessThanOrEqual(after + 90_000);
  expect(() => normalizeAutomationSchedule({ kind: 'cron', expr: 'broken' }, after)).toThrow();
  expect(() => normalizeAutomationSchedule({ kind: 'every', everyMs: Infinity }, after)).toThrow();
});

test('definitions reject removed execution bindings and channel fields instead of normalizing them', async () => {
  const { createAutomation } = await import('./automationDefinitions.mjs');
  const base = {
    name: 'Task',
    description: '',
    enabled: false,
    schedule: { kind: 'every' as const, everyMs: 1000 },
    sessionTarget: 'task' as const,
    wakeMode: 'now' as const,
    payload: { kind: 'agentTurn' as const, message: 'Run.' },
  };
  for (const patch of [
    { sessionTarget: 'main' },
    { sessionKey: 'existing-chat' },
    { wakeMode: 'next-heartbeat' },
    { delivery: { mode: 'none', channel: 'feishu' } },
    { delivery: { mode: 'announce' } },
  ]) {
    expect(() => createAutomation({ ...base, ...patch } as never, Date.now())).toThrow();
  }
});
