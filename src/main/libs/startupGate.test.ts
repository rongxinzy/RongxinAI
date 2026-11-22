import { expect, test, vi } from 'vitest';

import { settleWithin } from './startupGate';

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
