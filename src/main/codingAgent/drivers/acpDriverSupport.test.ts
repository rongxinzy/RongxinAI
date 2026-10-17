import { expect, test } from 'vitest';

import { CodingEventKind, CodingStreamUpdateMode } from '../../../shared/codingAgent';
import { mergeAdjacentDriverEvents, type DriverEvent } from './acpDriverSupport';

const messageDelta = (
  messageId: unknown,
  content: unknown,
  streamUpdateMode: CodingStreamUpdateMode = CodingStreamUpdateMode.Append,
): DriverEvent => ({
  kind: CodingEventKind.MessageDelta,
  payload: {
    messageId,
    content,
    role: 'assistant',
    streamUpdateMode,
  },
});

const toolCall = (toolCallId: unknown, extra: Record<string, unknown> = {}): DriverEvent => ({
  kind: CodingEventKind.ToolCall,
  payload: { toolCallId, ...extra },
});

test('merges appended message deltas that share a string message id', () => {
  expect(
    mergeAdjacentDriverEvents(messageDelta('m1', 'Hello, '), messageDelta('m1', 'world')),
  ).toEqual(messageDelta('m1', 'Hello, world'));
});

test('merges a delta whose previous content is not a string', () => {
  const previous = messageDelta('m1', undefined);
  expect(mergeAdjacentDriverEvents(previous, messageDelta('m1', 'world'))).toEqual(
    messageDelta('m1', 'world'),
  );
});

test('returns the newer delta untouched when it replaces the message', () => {
  const next = messageDelta('m1', 'new', CodingStreamUpdateMode.Replace);
  expect(mergeAdjacentDriverEvents(messageDelta('m1', 'old'), next)).toBe(next);
});

test('does not merge message deltas with different or non-string message ids', () => {
  expect(mergeAdjacentDriverEvents(messageDelta('m1', 'a'), messageDelta('m2', 'b'))).toBeNull();
  expect(mergeAdjacentDriverEvents(messageDelta(123, 'a'), messageDelta(123, 'b'))).toBeNull();
});

test('merges tool call updates that target the same tool call', () => {
  expect(
    mergeAdjacentDriverEvents(
      toolCall('tool-1', { title: 'Run tests' }),
      toolCall('tool-1', { status: 'completed' }),
    ),
  ).toEqual(toolCall('tool-1', { title: 'Run tests', status: 'completed' }));
});

test('does not merge tool calls or events of different kinds', () => {
  expect(mergeAdjacentDriverEvents(toolCall('tool-1'), toolCall('tool-2'))).toBeNull();
  expect(mergeAdjacentDriverEvents(toolCall('tool-1'), messageDelta('m1', 'text'))).toBeNull();
});
