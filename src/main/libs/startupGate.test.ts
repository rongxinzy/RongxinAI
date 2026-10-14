import { expect, test, vi } from 'vitest';

import { settleWithin, StartupGate } from './startupGate';

test('a start stays current until a stop cancels it', () => {
  const gate = new StartupGate();
  const first = gate.begin();

  expect(gate.isCurrent(first.token)).toBe(true);
  expect(first.signal.aborted).toBe(false);

  // Stopping during the runtime install must invalidate the start already
  // running and kill the child process it started.
  gate.cancel();
  expect(gate.isCurrent(first.token)).toBe(false);
  expect(first.signal.aborted).toBe(true);

  // A later attempt is unaffected by the older stop.
  const second = gate.begin();
  expect(gate.isCurrent(second.token)).toBe(true);
  expect(second.signal.aborted).toBe(false);
  expect(gate.isCurrent(first.token)).toBe(false);
});

test('settleWithin reports a finished task and gives up on a stuck one', async () => {
  vi.useFakeTimers();
  try {
    await expect(settleWithin(Promise.resolve(), 1_000)).resolves.toBe(true);
    // A failure is still a settle: a stop only needs the start-up to be over.
    await expect(settleWithin(Promise.reject(new Error('boom')), 1_000)).resolves.toBe(true);

    const stuck = settleWithin(new Promise(() => undefined), 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    // Bounded: a stop must not wait forever for work that will not finish.
    await expect(stuck).resolves.toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
