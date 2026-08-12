import { expect, test } from 'vitest';

import { getSessionTitleMarqueeMetrics } from './sessionTitleMarqueeMetrics';

test('does not animate a title that fits in the viewport', () => {
  expect(getSessionTitleMarqueeMetrics(120, 120)).toBeNull();
  expect(getSessionTitleMarqueeMetrics(120, 96)).toBeNull();
});

test('ignores subpixel overflow that would cause visual jitter', () => {
  expect(getSessionTitleMarqueeMetrics(120, 120.75)).toBeNull();
});

test('stops when the content right edge reaches the viewport right edge', () => {
  expect(getSessionTitleMarqueeMetrics(120, 240)).toEqual({
    distancePx: 120,
    durationMs: 2500,
  });
});

test('preserves subpixel precision at the final character edge', () => {
  expect(getSessionTitleMarqueeMetrics(180, 547.4375)).toEqual({
    distancePx: 367.4375,
    durationMs: 7655,
  });
});

test('uses a minimum duration for short overflow distances', () => {
  expect(getSessionTitleMarqueeMetrics(120, 130)).toEqual({
    distancePx: 10,
    durationMs: 900,
  });
});
