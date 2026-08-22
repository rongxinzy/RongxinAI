import { expect, test } from 'vitest';

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
