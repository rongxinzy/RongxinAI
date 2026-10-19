import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PiAssistantTranscript } from './piAssistantTranscript';
import type { ActivePiSession } from './piRuntimeSessionState';
import {
  STREAM_CHECKPOINT_GROWTH_CHARS,
  STREAM_CHECKPOINT_MIN_INTERVAL_MS,
} from './piRuntimeSessionState';
import { PiStreamAccumulator } from './piStreamAccumulator';
import { PiThinkingLifecycle } from './piThinkingLifecycle';
import { createPiTranslatorState } from './piTranslate/piTranslateUiMessageChunk';

const baseActive = (): ActivePiSession =>
  ({
    assistantMessageId: null,
    thinkingMessageId: null,
    answerText: '',
    thinkingText: '',
    retryPriorAnswer: '',
    turnExperts: [],
    thinkingLifecycle: new PiThinkingLifecycle(),
    streamAccumulator: new PiStreamAccumulator(),
    piTranslatorState: createPiTranslatorState(),
  }) as ActivePiSession;

describe('PiAssistantTranscript', () => {
  let transcript: PiAssistantTranscript;
  let storeUpdates: Array<{ messageId: string; content: string }>;

  beforeEach(() => {
    storeUpdates = [];
    transcript = new PiAssistantTranscript({
      getStore: () =>
        ({
          addMessage: (_sessionId: string, message: { id: string; content: string }) => message,
          updateMessage: (_sessionId: string, messageId: string, patch: { content?: string }) => {
            if (patch.content !== undefined) {
              storeUpdates.push({ messageId, content: patch.content });
            }
          },
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved: vi.fn(),
      hasStreamingTextSubscribers: () => true,
      getActiveSession: () => undefined,
    });
  });

  it('clears per-message throttle maps when finalizeMessage runs', () => {
    vi.useFakeTimers();
    const active = baseActive();
    transcript.streamInto('session', active, 'answer', 'draft one');
    transcript.finalizeMessage('session', active, 'answer', 'final text');
    transcript.streamInto('session', active, 'answer', 'next turn');
    vi.advanceTimersByTime(500);
    expect(storeUpdates.at(-1)?.content).toBe('next turn');
    vi.useRealTimers();
  });

  it.each(['answer', 'thinking'] as const)(
    'does not rewrite or re-emit a finalized %s when closing idle placeholders',
    kind => {
      const active = baseActive();
      const updateMessage = vi.fn();
      const emitMessageUpdate = vi.fn();
      const local = new PiAssistantTranscript({
        getStore: () =>
          ({
            addMessage: (_sessionId: string, message: { id: string }) => message,
            getMessage: () => ({ content: 'final body', metadata: { isFinal: true } }),
            updateMessage,
          }) as never,
        emitMessage: vi.fn(),
        emitMessageUpdate,
        emitMessageRemoved: vi.fn(),
        hasStreamingTextSubscribers: () => true,
        getActiveSession: () => active,
      });
      if (kind === 'answer') active.answerText = 'final body';
      else active.thinkingText = 'final body';
      local.finalizeMessage('session', active, kind, 'final body');
      updateMessage.mockClear();
      emitMessageUpdate.mockClear();

      // Error/settle cleanup may run after message_end already committed the
      // final body. Repeated cleanup must leave that row and terminal event alone.
      local.closeIdlePlaceholders('session', active, { finalize: true });
      local.closeIdlePlaceholders('session', active, { finalize: true });

      expect(updateMessage).not.toHaveBeenCalled();
      expect(emitMessageUpdate).not.toHaveBeenCalled();
    },
  );

  it('does not delete whitespace-only or retry-prior answer rows on closeIdle', () => {
    const emitMessageRemoved = vi.fn();
    const deleteMessage = vi.fn(() => true);
    const whitespaceRow = {
      id: 'ws-1',
      type: 'assistant' as const,
      content: '\n\n',
      metadata: { isStreaming: true },
    };
    const partialRow = {
      id: 'partial-1',
      type: 'assistant' as const,
      content: 'partial in db',
      metadata: { isStreaming: true },
    };

    const runCloseIdle = (row: typeof whitespaceRow, active: ActivePiSession): void => {
      const updateMessage = vi.fn();
      const local = new PiAssistantTranscript({
        getStore: () =>
          ({
            getMessage: (_sessionId: string, messageId: string) =>
              messageId === row.id ? row : null,
            updateMessage,
            deleteMessage,
          }) as never,
        emitMessage: vi.fn(),
        emitMessageUpdate: vi.fn(),
        emitMessageRemoved,
        hasStreamingTextSubscribers: () => true,
        getActiveSession: () => active,
      });
      local.closeIdlePlaceholders('session', active, { finalize: true });
    };

    const whitespaceActive = baseActive();
    whitespaceActive.assistantMessageId = whitespaceRow.id;
    whitespaceActive.answerText = '\n\n';
    runCloseIdle(whitespaceRow, whitespaceActive);

    const retryActive = baseActive();
    retryActive.assistantMessageId = partialRow.id;
    retryActive.answerText = '';
    retryActive.retryPriorAnswer = 'partial in db';
    runCloseIdle(partialRow, retryActive);

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(emitMessageRemoved).not.toHaveBeenCalled();
  });

  it('merges existing metadata when closeIdle finalizes on error', () => {
    const updateMessage = vi.fn();
    const thinkingRow = {
      id: 'think-1',
      type: 'assistant' as const,
      content: 'thought body',
      metadata: {
        isStreaming: true,
        isThinking: true,
        thinkingDurationMs: 4321,
      },
    };
    const active = baseActive();
    active.thinkingMessageId = thinkingRow.id;
    active.thinkingText = 'thought body';
    const local = new PiAssistantTranscript({
      getStore: () =>
        ({
          getMessage: (_sessionId: string, messageId: string) =>
            messageId === thinkingRow.id ? thinkingRow : null,
          updateMessage: updateMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved: vi.fn(),
      hasStreamingTextSubscribers: () => true,
      getActiveSession: () => active,
    });
    local.closeIdlePlaceholders('session', active, { finalize: true });
    expect(updateMessage).toHaveBeenCalledWith(
      'session',
      thinkingRow.id,
      expect.objectContaining({
        metadata: expect.objectContaining({ thinkingDurationMs: 4321, isThinking: true }),
      }),
      expect.anything(),
    );
  });

  it('does not delete a placeholder when persisted content is non-empty', () => {
    const deleteMessage = vi.fn(() => true);
    const row = {
      id: 'persisted-1',
      type: 'assistant' as const,
      content: 'visible in db',
      metadata: { isStreaming: true },
    };
    const active = baseActive();
    active.assistantMessageId = row.id;
    const local = new PiAssistantTranscript({
      getStore: () =>
        ({
          getMessage: (_sessionId: string, messageId: string) =>
            messageId === row.id ? row : null,
          updateMessage: vi.fn(),
          deleteMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved: vi.fn(),
      hasStreamingTextSubscribers: () => true,
      getActiveSession: () => active,
    });
    local.closeIdlePlaceholders('session', active, { finalize: true });
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('removeEmptyAnswerPlaceholder keeps rows when active answer text is in memory', () => {
    const deleteMessage = vi.fn(() => true);
    const emitMessageRemoved = vi.fn();
    const row = {
      id: 'in-memory-1',
      type: 'assistant' as const,
      content: '',
      metadata: { isStreaming: true },
    };
    const active = baseActive();
    active.assistantMessageId = row.id;
    active.answerText = 'only in active.answerText';
    const local = new PiAssistantTranscript({
      getStore: () =>
        ({
          getMessage: (_sessionId: string, messageId: string) =>
            messageId === row.id ? row : null,
          updateMessage: vi.fn(),
          deleteMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved,
      hasStreamingTextSubscribers: () => true,
      getActiveSession: () => active,
    });
    (
      local as unknown as {
        removeEmptyAnswerPlaceholder: (
          sessionId: string,
          messageId: string,
          active: ActivePiSession,
        ) => void;
      }
    ).removeEmptyAnswerPlaceholder('session', row.id, active);
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(emitMessageRemoved).not.toHaveBeenCalled();
  });

  it('does not delete a placeholder when streamed content was captured in memory', () => {
    const deleteMessage = vi.fn(() => true);
    const row = {
      id: 'streamed-1',
      type: 'assistant' as const,
      content: '',
      metadata: { isStreaming: true },
    };
    const active = baseActive();
    active.assistantMessageId = row.id;
    const local = new PiAssistantTranscript({
      getStore: () =>
        ({
          getMessage: (_sessionId: string, messageId: string) =>
            messageId === row.id ? row : null,
          updateMessage: vi.fn(),
          deleteMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved: vi.fn(),
      hasStreamingTextSubscribers: () => true,
      getActiveSession: () => active,
    });
    local.streamInto('session', active, 'answer', 'delta text');
    active.answerText = '';
    local.closeIdlePlaceholders('session', active, { finalize: true });
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('does not delete a placeholder when resolveStreamedContent has retry prior answer', () => {
    const deleteMessage = vi.fn(() => true);
    const row = {
      id: 'retry-1',
      type: 'assistant' as const,
      content: '',
      metadata: { isStreaming: true },
    };
    const active = baseActive();
    active.assistantMessageId = row.id;
    active.retryPriorAnswer = 'partial from prior attempt';
    const local = new PiAssistantTranscript({
      getStore: () =>
        ({
          getMessage: (_sessionId: string, messageId: string) =>
            messageId === row.id ? row : null,
          updateMessage: vi.fn(),
          deleteMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved: vi.fn(),
      hasStreamingTextSubscribers: () => true,
      getActiveSession: () => active,
    });
    local.closeIdlePlaceholders('session', active, { finalize: true });
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('finalizeMessage with empty content uses resolved streamed answer text', () => {
    const updateMessage = vi.fn();
    const row = {
      id: 'stream-finalize-1',
      type: 'assistant' as const,
      content: '',
      metadata: { isStreaming: true },
    };
    const active = baseActive();
    active.assistantMessageId = row.id;
    const local = new PiAssistantTranscript({
      getStore: () =>
        ({
          getMessage: (_sessionId: string, messageId: string) =>
            messageId === row.id ? row : null,
          updateMessage,
          addMessage: vi.fn(),
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved: vi.fn(),
      hasStreamingTextSubscribers: () => true,
      getActiveSession: () => active,
    });
    active.retryPriorAnswer = 'resolved prior answer';
    active.answerText = '';
    local.finalizeMessage('session', active, 'answer', '');
    const finalizePatch = updateMessage.mock.calls.find(
      call => call[1] === row.id && (call[2] as { content?: string })?.content,
    )?.[2] as { content?: string; metadata?: Record<string, unknown> } | undefined;
    expect(finalizePatch?.content).toBe('resolved prior answer');
    expect(finalizePatch?.metadata).toMatchObject({ isStreaming: false, isFinal: true });
  });

  it('finalizeMessage empty path removes placeholder before clearing streamed memory', () => {
    const deleteMessage = vi.fn(() => true);
    const row = {
      id: 'throttle-order-1',
      type: 'assistant' as const,
      content: '',
      metadata: { isStreaming: true },
    };
    const active = baseActive();
    active.assistantMessageId = row.id;
    const local = new PiAssistantTranscript({
      getStore: () =>
        ({
          getMessage: (_sessionId: string, messageId: string) =>
            messageId === row.id ? row : null,
          updateMessage: vi.fn(),
          deleteMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved: vi.fn(),
      hasStreamingTextSubscribers: () => true,
      getActiveSession: () => active,
    });
    local.streamInto('session', active, 'answer', 'streamed body');
    active.answerText = '';
    local.finalizeMessage('session', active, 'answer', '');
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('removes a never-displayed empty placeholder and emits messageRemoved', () => {
    const emitMessageRemoved = vi.fn();
    const deleteMessage = vi.fn(() => true);
    const emptyRow = {
      id: 'empty-1',
      type: 'assistant' as const,
      content: '',
      metadata: { isStreaming: true },
    };
    const active = baseActive();
    active.assistantMessageId = emptyRow.id;
    const local = new PiAssistantTranscript({
      getStore: () =>
        ({
          getMessage: (_sessionId: string, messageId: string) =>
            messageId === emptyRow.id ? emptyRow : null,
          updateMessage: vi.fn(),
          deleteMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved,
      hasStreamingTextSubscribers: () => true,
      getActiveSession: () => active,
    });
    local.closeIdlePlaceholders('session', active, { finalize: true });
    expect(deleteMessage).toHaveBeenCalledWith('session', emptyRow.id);
    expect(emitMessageRemoved).toHaveBeenCalledWith('session', emptyRow.id);
  });

  it('checkpoints the store only after the body grows past the threshold', () => {
    const active = baseActive();
    let streamed = '';
    // Grow well past the threshold in small increments: only growth-bound
    // checkpoints may hit the store, not one write per increment.
    for (let i = 0; i < 100; i += 1) {
      streamed += 'x'.repeat(1024);
      transcript.streamInto('session', active, 'answer', streamed);
    }
    // 100 KiB streamed with a 32 KiB threshold: at most three checkpoints —
    // far below the old per-tick write count — and the tail below the
    // threshold stays unwritten until finalize.
    expect(storeUpdates.length).toBeLessThanOrEqual(
      Math.floor(streamed.length / STREAM_CHECKPOINT_GROWTH_CHARS) + 1,
    );
    expect(storeUpdates.at(-1)?.content.length).toBeLessThan(streamed.length);
    transcript.finalizeMessage('session', active, 'answer', streamed);
    expect(storeUpdates.at(-1)?.content).toBe(streamed);
    expect(
      storeUpdates.filter(update => update.content === streamed).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('checkpoints a slowly growing body at least once per interval', () => {
    vi.useFakeTimers();
    const active = baseActive();
    transcript.streamInto('session', active, 'answer', 'first delta');
    // Most replies never reach the growth threshold; after the interval floor
    // the next growth must still reach the store so a crash mid-stream cannot
    // leave the row at the first few characters.
    vi.advanceTimersByTime(STREAM_CHECKPOINT_MIN_INTERVAL_MS);
    const before = storeUpdates.length;
    transcript.streamInto('session', active, 'answer', 'first delta plus more text');
    expect(storeUpdates.length).toBe(before + 1);
    expect(storeUpdates.at(-1)?.content).toBe('first delta plus more text');
    vi.useRealTimers();
  });

  it('never rewrites an unchanged body on the interval floor', () => {
    vi.useFakeTimers();
    const active = baseActive();
    transcript.streamInto('session', active, 'answer', 'same body');
    const before = storeUpdates.length;
    vi.advanceTimersByTime(STREAM_CHECKPOINT_MIN_INTERVAL_MS * 2);
    transcript.streamInto('session', active, 'answer', 'same body');
    expect(storeUpdates.length).toBe(before);
    vi.useRealTimers();
  });

  it('writes immediately when a rewrite shrinks the persisted body', () => {
    const active = baseActive();
    transcript.streamInto('session', active, 'answer', 'long body '.repeat(200));
    // A non-prefix rewrite (reasoning collapse, retry reopen) makes the body
    // shorter than what is persisted; write now instead of keeping stale text.
    transcript.streamInto('session', active, 'answer', 'short replacement');
    expect(storeUpdates.at(-1)?.content).toBe('short replacement');
    transcript.finalizeMessage('session', active, 'answer', 'short replacement');
    expect(storeUpdates.at(-1)?.content).toBe('short replacement');
  });

  it('skips non-final messageUpdate when no streaming-text subscriber exists', () => {
    const emitMessageUpdate = vi.fn();
    const active = baseActive();
    const local = new PiAssistantTranscript({
      getStore: () => null,
      emitMessage: vi.fn(),
      emitMessageUpdate,
      emitMessageRemoved: vi.fn(),
      hasStreamingTextSubscribers: () => false,
      getActiveSession: () => active,
    });
    local.streamInto('session', active, 'answer', 'partial body');
    expect(emitMessageUpdate).not.toHaveBeenCalled();
    local.finalizeMessage('session', active, 'answer', 'final body');
    expect(emitMessageUpdate).toHaveBeenCalledWith(
      'session',
      expect.any(String),
      'final body',
      expect.objectContaining({ isStreaming: false, isFinal: true }),
    );
  });
});
