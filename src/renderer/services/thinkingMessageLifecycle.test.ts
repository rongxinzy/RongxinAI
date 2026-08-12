import { expect, test, vi } from 'vitest';

import type { StreamMessageUpdate } from './rafMessageUpdateBatcher';
import { ThinkingMessageLifecycle } from './thinkingMessageLifecycle';

test('completes a thinking message as soon as reasoning ends', () => {
  const discard = vi.fn();
  const updates: StreamMessageUpdate[] = [];
  const lifecycle = new ThinkingMessageLifecycle('session-1', 'thinking-1', { discard }, update =>
    updates.push(update),
  );

  lifecycle.start(1000);
  expect(
    lifecycle.complete({ content: 'Checked the implementation', messageExists: true, nowMs: 2400 }),
  ).toBe(1400);

  expect(discard).toHaveBeenCalledWith('session-1', 'thinking-1');
  expect(updates).toEqual([
    {
      sessionId: 'session-1',
      messageId: 'thinking-1',
      content: 'Checked the implementation',
      metadata: {
        isStreaming: false,
        isFinal: true,
        isThinking: true,
        thinkingDurationMs: 1400,
      },
    },
  ]);
  expect(lifecycle.isComplete).toBe(true);
  expect(lifecycle.durationMs).toBe(1400);
});

test('completion is idempotent until a new reasoning segment starts', () => {
  const updates: StreamMessageUpdate[] = [];
  const lifecycle = new ThinkingMessageLifecycle(
    'session-1',
    'thinking-1',
    { discard: vi.fn() },
    update => updates.push(update),
  );

  lifecycle.start(1000);
  lifecycle.complete({ content: 'First segment', messageExists: true, nowMs: 1500 });
  lifecycle.complete({ content: 'First segment', messageExists: true, nowMs: 2000 });
  expect(updates).toHaveLength(1);

  lifecycle.start(3000);
  lifecycle.complete({
    content: 'First segment\nSecond segment',
    messageExists: true,
    nowMs: 3500,
  });
  expect(updates).toHaveLength(2);
  expect(updates[1].metadata?.thinkingDurationMs).toBe(1000);
});

test('completes active thinking when answer starts without a reasoning-end event', () => {
  const discard = vi.fn();
  const updates: StreamMessageUpdate[] = [];
  const lifecycle = new ThinkingMessageLifecycle('session-1', 'thinking-1', { discard }, update =>
    updates.push(update),
  );

  lifecycle.start(1000);
  expect(lifecycle.completeBeforeAnswer('Checked the implementation', true, 1750)).toBe(750);

  expect(discard).toHaveBeenCalledWith('session-1', 'thinking-1');
  expect(updates).toEqual([
    {
      sessionId: 'session-1',
      messageId: 'thinking-1',
      content: 'Checked the implementation',
      metadata: {
        isStreaming: false,
        isFinal: true,
        isThinking: true,
        thinkingDurationMs: 750,
      },
    },
  ]);
});
