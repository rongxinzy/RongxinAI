import { afterEach, expect, test, vi } from 'vitest';

import { MemoryOutboxScheduler } from './memoryOutboxScheduler';

afterEach(() => vi.useRealTimers());

test('backoff wakes at the earliest available time and drains every batch', async () => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-29T00:00:00.000Z');
  let next = new Date(Date.now() + 2_000).toISOString();
  const drain = vi.fn(async () => {
    next = new Date(Date.now() + 2_000).toISOString();
  });
  const scheduler = new MemoryOutboxScheduler({
    drain,
    nextAvailableAt: () => next,
    onError: vi.fn(),
  });

  scheduler.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(drain).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(drain).toHaveBeenCalledTimes(2);
  await scheduler.stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(drain).toHaveBeenCalledTimes(2);
});

test('due batches are drained repeatedly and stop waits for the active drain', async () => {
  vi.useFakeTimers();
  let remaining = 45;
  const drain = vi.fn(async () => {
    remaining = Math.max(0, remaining - 20);
  });
  const scheduler = new MemoryOutboxScheduler({
    drain,
    nextAvailableAt: () => (remaining > 0 ? new Date(0).toISOString() : null),
    onError: vi.fn(),
  });

  scheduler.start();
  await vi.runAllTimersAsync();
  expect(drain).toHaveBeenCalledTimes(3);
  expect(remaining).toBe(0);
  await scheduler.stop();
});
