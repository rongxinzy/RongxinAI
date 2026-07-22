import { expect, test } from 'vitest';

import {
  RafMessageUpdateBatcher,
  type AnimationFrameScheduler,
  type StreamMessageUpdate,
} from './rafMessageUpdateBatcher';

const createScheduler = () => {
  let callback: FrameRequestCallback | null = null;
  let canceled = false;
  const scheduler: AnimationFrameScheduler = {
    request: next => {
      callback = next;
      return 1;
    },
    cancel: () => {
      canceled = true;
      callback = null;
    },
  };

  return {
    scheduler,
    runFrame: () => callback?.(0),
    wasCanceled: () => canceled,
  };
};

const update = (messageId: string, content: string): StreamMessageUpdate => ({
  sessionId: 'session-1',
  messageId,
  content,
});

test('keeps the latest update for each message in the same frame', () => {
  const applied: StreamMessageUpdate[] = [];
  const frame = createScheduler();
  const batcher = new RafMessageUpdateBatcher(item => applied.push(item), frame.scheduler);

  batcher.enqueue(update('thinking', 'partial'));
  batcher.enqueue(update('answer', 'answer'));
  batcher.enqueue(update('thinking', 'complete reasoning'));
  frame.runFrame();

  expect(applied).toEqual([update('thinking', 'complete reasoning'), update('answer', 'answer')]);
});

test('discards a finalised message without dropping other pending messages', () => {
  const applied: StreamMessageUpdate[] = [];
  const frame = createScheduler();
  const batcher = new RafMessageUpdateBatcher(item => applied.push(item), frame.scheduler);

  batcher.enqueue(update('thinking', 'stale'));
  batcher.enqueue(update('answer', 'current'));
  batcher.discard('session-1', 'thinking');
  frame.runFrame();

  expect(applied).toEqual([update('answer', 'current')]);
  expect(frame.wasCanceled()).toBe(false);
});
