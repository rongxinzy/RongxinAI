import { expect, test, vi } from 'vitest';

import {
  isPiPureTextTruncation,
  PiTruncatedAnswerRecovery,
} from './piTruncatedAnswerRecovery';
import {
  PiAssistantStopReason,
  PiBuiltinFileToolName,
  PiContentBlockType,
  type PiSteeringSession,
} from './piWriteTokenLimit';

const createSession = (): PiSteeringSession & { steer: ReturnType<typeof vi.fn> } => ({
  steer: vi.fn().mockResolvedValue(undefined),
});

test('detects pure-text truncation only for length without tool calls', () => {
  expect(
    isPiPureTextTruncation({
      stopReason: PiAssistantStopReason.Length,
      content: [{ type: PiContentBlockType.Text, text: 'cut off mid-sentence' }],
    }),
  ).toBe(true);
  expect(
    isPiPureTextTruncation({ stopReason: PiAssistantStopReason.Length, content: 'plain text' }),
  ).toBe(true);
  expect(
    isPiPureTextTruncation({
      stopReason: PiAssistantStopReason.Length,
      content: [
        { type: PiContentBlockType.Text, text: 'Writing' },
        {
          type: PiContentBlockType.ToolCall,
          id: 'call-1',
          name: PiBuiltinFileToolName.Write,
          arguments: { path: 'a.js', content: 'partial' },
        },
      ],
    }),
  ).toBe(false);
  expect(
    isPiPureTextTruncation({
      stopReason: PiAssistantStopReason.Stop,
      content: [{ type: PiContentBlockType.Text, text: 'complete' }],
    }),
  ).toBe(false);
  expect(
    isPiPureTextTruncation({
      stopReason: PiAssistantStopReason.Error,
      content: [{ type: PiContentBlockType.Text, text: 'failed' }],
    }),
  ).toBe(false);
});

test('queues at most one continuation steer per turn', () => {
  const session = createSession();
  const recovery = new PiTruncatedAnswerRecovery();
  const truncated = {
    stopReason: PiAssistantStopReason.Length,
    content: [{ type: PiContentBlockType.Text, text: 'partial' }],
  };

  expect(recovery.queueIfNeeded(truncated, session)).toBe(true);
  expect(session.steer).toHaveBeenCalledOnce();
  expect(session.steer).toHaveBeenCalledWith(expect.stringContaining('output token limit'));

  // Budget exhausted: a second truncated message in the same turn is not steered.
  expect(recovery.queueIfNeeded({ ...truncated }, session)).toBe(false);
  expect(session.steer).toHaveBeenCalledOnce();
});

test('never queues for non-truncated or tool-carrying messages', () => {
  const session = createSession();
  const recovery = new PiTruncatedAnswerRecovery();

  expect(
    recovery.queueIfNeeded(
      {
        stopReason: PiAssistantStopReason.Stop,
        content: [{ type: PiContentBlockType.Text, text: 'done' }],
      },
      session,
    ),
  ).toBe(false);
  expect(
    recovery.queueIfNeeded(
      {
        stopReason: PiAssistantStopReason.Length,
        content: [
          {
            type: PiContentBlockType.ToolCall,
            id: 'call-1',
            name: PiBuiltinFileToolName.Write,
            arguments: { path: 'a.js', content: 'partial' },
          },
        ],
      },
      session,
    ),
  ).toBe(false);
  expect(session.steer).not.toHaveBeenCalled();
});

test('reset re-arms the continuation budget for a new turn', () => {
  const session = createSession();
  const recovery = new PiTruncatedAnswerRecovery();
  const truncated = {
    stopReason: PiAssistantStopReason.Length,
    content: [{ type: PiContentBlockType.Text, text: 'partial' }],
  };

  expect(recovery.queueIfNeeded(truncated, session)).toBe(true);
  recovery.reset();
  expect(recovery.queueIfNeeded({ ...truncated }, session)).toBe(true);
  expect(session.steer).toHaveBeenCalledTimes(2);
});

test('a synchronous steer failure rolls the attempt back', async () => {
  const session: PiSteeringSession = {
    steer: vi.fn(() => {
      throw new Error('not streaming');
    }),
  };
  const recovery = new PiTruncatedAnswerRecovery();
  const truncated = {
    stopReason: PiAssistantStopReason.Length,
    content: [{ type: PiContentBlockType.Text, text: 'partial' }],
  };

  expect(recovery.queueIfNeeded(truncated, session)).toBe(false);
  // The failed attempt did not consume the budget.
  expect(recovery.queueIfNeeded({ ...truncated }, session)).toBe(false);
});

test('an async steer rejection rolls the attempt back after the promise settles', async () => {
  const session: PiSteeringSession = {
    steer: vi.fn().mockRejectedValue(new Error('queue rejected')),
  };
  const recovery = new PiTruncatedAnswerRecovery();
  const truncated = {
    stopReason: PiAssistantStopReason.Length,
    content: [{ type: PiContentBlockType.Text, text: 'partial' }],
  };

  expect(recovery.queueIfNeeded(truncated, session)).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 0));

  // The rejected steer did not consume the budget: a healthy session can queue.
  const healthySession = createSession();
  expect(recovery.queueIfNeeded({ ...truncated }, healthySession)).toBe(true);
  expect(healthySession.steer).toHaveBeenCalledOnce();
});
