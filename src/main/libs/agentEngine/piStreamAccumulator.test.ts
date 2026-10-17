import { describe, expect, test } from 'vitest';

import { PiStreamAccumulator } from './piStreamAccumulator';
import { PiAssistantEventType } from './piStreamConstants';

test('accumulates Pi 0.84 delta-only thinking and text events', () => {
  const accumulator = new PiStreamAccumulator();

  accumulator.update({ type: PiAssistantEventType.ThinkingStart, contentIndex: 0 });
  accumulator.update({
    type: PiAssistantEventType.ThinkingDelta,
    contentIndex: 0,
    delta: 'plan ',
  });
  expect(
    accumulator.update({
      type: PiAssistantEventType.ThinkingEnd,
      contentIndex: 0,
      content: 'plan first',
    }),
  ).toEqual({ text: '', thinking: 'plan first' });

  accumulator.update({ type: PiAssistantEventType.TextStart, contentIndex: 1 });
  accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 1, delta: 'done' });
  expect(accumulator.update({ type: PiAssistantEventType.TextEnd, contentIndex: 1 })).toEqual({
    text: 'done',
    thinking: 'plan first',
  });
});

test('orders multiple text segments by content index', () => {
  const accumulator = new PiStreamAccumulator();

  accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 2, delta: 'second' });
  expect(
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'first ' }),
  ).toEqual({ text: 'first second', thinking: '' });
});

test('uses a legacy cumulative snapshot when no delta is available', () => {
  const accumulator = new PiStreamAccumulator();

  expect(
    accumulator.update(undefined, {
      content: [
        { type: 'thinking', thinking: 'checking' },
        { type: 'text', text: 'answer' },
      ],
    }),
  ).toEqual({ text: 'answer', thinking: 'checking' });
});

test('reconciles accumulated deltas with the authoritative final message', () => {
  const accumulator = new PiStreamAccumulator();
  accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'partial' });

  expect(
    accumulator.reconcile({
      content: [
        { type: 'thinking', thinking: 'final thought' },
        { type: 'text', text: 'final answer' },
      ],
    }),
  ).toEqual({ text: 'final answer', thinking: 'final thought' });
});

test('ignores malformed final content without throwing', () => {
  const accumulator = new PiStreamAccumulator();

  expect(accumulator.reconcile({ content: null })).toEqual({ text: '', thinking: '' });
  expect(accumulator.reconcile({ content: {} as never })).toEqual({ text: '', thinking: '' });
});

describe('lastUpdateAppendedOnly', () => {
  test('appending to the only segment is append-only', () => {
    const accumulator = new PiStreamAccumulator();
    accumulator.update({ type: PiAssistantEventType.TextStart, contentIndex: 0 });
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'Hello' });

    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: ' world' });

    expect(accumulator.lastUpdateAppendedOnly('text', 6)).toBe(true);
  });

  test('opening a new segment at a higher index is append-only', () => {
    const accumulator = new PiStreamAccumulator();
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'first' });

    expect(
      accumulator.update({
        type: PiAssistantEventType.TextDelta,
        contentIndex: 2,
        delta: 'second',
      }),
    ).toEqual({ text: 'firstsecond', thinking: '' });
    expect(accumulator.lastUpdateAppendedOnly('text', 6)).toBe(true);
  });

  test('growing a non-last segment is not append-only', () => {
    const accumulator = new PiStreamAccumulator();
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'a' });
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 2, delta: 'tail' });

    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'b' });

    expect(accumulator.lastUpdateAppendedOnly('text', 1)).toBe(false);
  });

  test('reconcile inserting text mid-message is not append-only', () => {
    const accumulator = new PiStreamAccumulator();
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'ab' });
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 2, delta: 'cd' });

    accumulator.reconcile({
      content: [
        { type: 'text', text: 'aXb' },
        { type: 'text', text: 'cd' },
      ],
    });

    expect(accumulator.lastUpdateAppendedOnly('text', 1)).toBe(false);
  });

  test('last segment growth unequal to the delta length is not append-only', () => {
    const accumulator = new PiStreamAccumulator();
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'abc' });

    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'de' });

    expect(accumulator.lastUpdateAppendedOnly('text', 3)).toBe(false);
    expect(accumulator.lastUpdateAppendedOnly('text', 2)).toBe(true);
  });

  test('a deleted segment is not append-only', () => {
    const accumulator = new PiStreamAccumulator();
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'first' });
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 2, delta: 'second' });

    accumulator.reconcile({ content: [{ type: 'text', text: 'first' }] });

    expect(accumulator.lastUpdateAppendedOnly('text', 6)).toBe(false);
  });

  test('non-positive delta lengths are never append-only', () => {
    const accumulator = new PiStreamAccumulator();
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'abc' });

    expect(accumulator.lastUpdateAppendedOnly('text', 0)).toBe(false);
    expect(accumulator.lastUpdateAppendedOnly('text', -1)).toBe(false);
  });

  test('text and thinking verdicts do not affect each other', () => {
    const accumulator = new PiStreamAccumulator();
    accumulator.update({
      type: PiAssistantEventType.ThinkingDelta,
      contentIndex: 0,
      delta: 'think',
    });
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 1, delta: 'answer' });

    expect(accumulator.lastUpdateAppendedOnly('text', 6)).toBe(true);
    expect(accumulator.lastUpdateAppendedOnly('thinking', 5)).toBe(false);

    accumulator.update({
      type: PiAssistantEventType.ThinkingDelta,
      contentIndex: 0,
      delta: ' more',
    });

    expect(accumulator.lastUpdateAppendedOnly('thinking', 5)).toBe(true);
    expect(accumulator.lastUpdateAppendedOnly('text', 6)).toBe(false);
  });

  test('reset clears the recorded segment tables', () => {
    const accumulator = new PiStreamAccumulator();
    accumulator.update({ type: PiAssistantEventType.TextDelta, contentIndex: 0, delta: 'abc' });
    accumulator.reset();

    expect(accumulator.lastUpdateAppendedOnly('text', 3)).toBe(false);
  });
});
