import { expect, test } from 'vitest';

import { ThinkingDurationTracker, toThinkingDurationSeconds } from './thinkingDuration';

test('tracks independent thinking segments without counting the gap between them', () => {
  const tracker = new ThinkingDurationTracker();

  tracker.start(1000);
  expect(tracker.finish(2200)).toBe(1200);
  tracker.start(5000);
  expect(tracker.finish(5800)).toBe(2000);
});

test('does not restart an active thinking segment', () => {
  const tracker = new ThinkingDurationTracker();

  tracker.start(1000);
  tracker.start(1500);

  expect(tracker.finish(2000)).toBe(1000);
});

test('resets accumulated thinking duration for the next turn', () => {
  const tracker = new ThinkingDurationTracker();

  tracker.start(1000);
  tracker.finish(2000);
  tracker.reset();

  expect(tracker.finish(3000)).toBeUndefined();
});

test('converts persisted milliseconds to display seconds', () => {
  expect(toThinkingDurationSeconds(0)).toBe(1);
  expect(toThinkingDurationSeconds(1001)).toBe(2);
  expect(toThinkingDurationSeconds(undefined)).toBeUndefined();
  expect(toThinkingDurationSeconds(-1)).toBeUndefined();
});
