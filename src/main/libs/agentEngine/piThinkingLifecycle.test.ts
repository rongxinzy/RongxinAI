import { expect, test } from 'vitest';

import { PiThinkingLifecycle } from './piThinkingLifecycle';

test('tracks an open thinking segment until it is finalized', () => {
  const lifecycle = new PiThinkingLifecycle();

  lifecycle.start(1000);
  lifecycle.markContentStreaming();
  expect(lifecycle.isSegmentOpen).toBe(true);
  expect(lifecycle.isMessageFinalized).toBe(false);
  expect(lifecycle.finish(2200)).toBe(1200);

  lifecycle.markMessageFinalized();
  expect(lifecycle.isSegmentOpen).toBe(false);
  expect(lifecycle.isMessageFinalized).toBe(true);
});

test('reopens completion state for a later thinking segment', () => {
  const lifecycle = new PiThinkingLifecycle();

  lifecycle.start(1000);
  lifecycle.finish(1500);
  lifecycle.markMessageFinalized();
  lifecycle.start(3000);

  expect(lifecycle.isSegmentOpen).toBe(true);
  expect(lifecycle.isMessageFinalized).toBe(false);
  expect(lifecycle.finish(3500)).toBe(1000);
});
