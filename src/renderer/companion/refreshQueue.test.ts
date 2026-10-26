import { expect, test, vi } from 'vitest';
import { createCompanionRefreshQueue } from './refreshQueue';

test('a burst of invalidations keeps one read in flight and rechecks the latest state', async () => {
  let release: () => void = () => {};
  let version = 0;
  const observed: number[] = [];
  const load = vi.fn(async () => {
    observed.push(version);
    if (observed.length === 1)
      await new Promise<void>(resolve => {
        release = resolve;
      });
  });
  const queue = createCompanionRefreshQueue(load);
  const first = queue.request();
  for (let i = 1; i <= 20; i++) {
    version = i;
    void queue.request();
  }
  expect(load).toHaveBeenCalledOnce();
  release();
  await first;
  expect(observed).toEqual([0, 20]);
});

test('disposing a hidden surface drops queued refreshes without interrupting its current read', async () => {
  let release: () => void = () => {};
  const load = vi.fn(
    () =>
      new Promise<void>(resolve => {
        release = resolve;
      }),
  );
  const queue = createCompanionRefreshQueue(load);
  const current = queue.request();
  void queue.request();
  queue.dispose();
  release();
  await current;
  await queue.request();
  expect(load).toHaveBeenCalledOnce();
});
