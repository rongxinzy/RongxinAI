import { afterEach, expect, test, vi } from 'vitest';

import {
  CodingEventKind,
  CodingStreamContentLengthField,
  CodingStreamUpdateMode,
  type CodingEvent,
} from '../../shared/codingAgent';
import { CodingEventDeltaBatcher } from './codingEventDeltaBatcher';

afterEach(() => vi.useRealTimers());

test('coalesces updates for the same event before flushing', () => {
  vi.useFakeTimers();
  const onFlush = vi.fn();
  const batcher = new CodingEventDeltaBatcher(onFlush, 100);
  const first = {
    id: 'event-1',
    laneId: 'lane',
    sequence: 1,
    kind: CodingEventKind.MessageDelta,
    payload: { content: 'a' },
    createdAt: 1,
  };
  const second = { ...first, payload: { content: 'ab' } };

  batcher.enqueue('/workspace', first);
  batcher.enqueue('/workspace', second);
  vi.advanceTimersByTime(100);

  expect(onFlush).toHaveBeenCalledTimes(1);
  expect(onFlush).toHaveBeenCalledWith({ workspaceRoot: '/workspace', events: [second] });
  batcher.dispose();
});

const textEvent = (
  content: string,
  mode: (typeof CodingStreamUpdateMode)[keyof typeof CodingStreamUpdateMode],
  extra: Record<string, unknown> = {},
): CodingEvent => ({
  id: 'event-1',
  laneId: 'lane',
  sequence: 1,
  kind: CodingEventKind.MessageDelta,
  payload: { content, streamUpdateMode: mode, phase: 'streaming', ...extra },
  createdAt: 1,
});

const flushPair = (first: CodingEvent, second: CodingEvent): ReturnType<typeof vi.fn> => {
  vi.useFakeTimers();
  const onFlush = vi.fn();
  const batcher = new CodingEventDeltaBatcher(onFlush, 100);
  batcher.enqueue('/workspace', first);
  vi.advanceTimersByTime(100);
  batcher.enqueue('/workspace', second);
  vi.advanceTimersByTime(100);
  batcher.dispose();
  return onFlush;
};

test('sends only the appended suffix after the previous flush', () => {
  const onFlush = flushPair(
    textEvent('a', CodingStreamUpdateMode.Append),
    textEvent('ab', CodingStreamUpdateMode.Append),
  );

  expect(onFlush).toHaveBeenNthCalledWith(2, {
    workspaceRoot: '/workspace',
    events: [
      textEvent('b', CodingStreamUpdateMode.Append, { [CodingStreamContentLengthField]: 2 }),
    ],
  });
});

test('sends a replace suffix when the full text still extends the previous frame', () => {
  const onFlush = flushPair(
    textEvent('hello', CodingStreamUpdateMode.Replace),
    textEvent('hello!', CodingStreamUpdateMode.Replace),
  );

  expect(onFlush).toHaveBeenNthCalledWith(2, {
    workspaceRoot: '/workspace',
    events: [
      textEvent('!', CodingStreamUpdateMode.Replace, { [CodingStreamContentLengthField]: 6 }),
    ],
  });
});

test('sends the full text when a replace frame is no longer a prefix', () => {
  const onFlush = flushPair(
    textEvent('hello', CodingStreamUpdateMode.Replace),
    textEvent('world', CodingStreamUpdateMode.Replace),
  );

  expect(onFlush).toHaveBeenNthCalledWith(2, {
    workspaceRoot: '/workspace',
    events: [
      textEvent('world', CodingStreamUpdateMode.Replace, { [CodingStreamContentLengthField]: 5 }),
    ],
  });
});

test('keeps an empty suffix so other payload fields still flush', () => {
  const onFlush = flushPair(
    textEvent('ab', CodingStreamUpdateMode.Append),
    textEvent('ab', CodingStreamUpdateMode.Append, { phase: 'done' }),
  );

  expect(onFlush).toHaveBeenNthCalledWith(2, {
    workspaceRoot: '/workspace',
    events: [
      textEvent('', CodingStreamUpdateMode.Append, {
        phase: 'done',
        [CodingStreamContentLengthField]: 2,
      }),
    ],
  });
});
