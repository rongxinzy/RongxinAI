import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PiAssistantTranscript } from './piAssistantTranscript';
import type { ActivePiSession } from './piRuntimeSessionState';
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
            getSession: () => ({ messages: [row] }),
            updateMessage,
            deleteMessage,
          }) as never,
        emitMessage: vi.fn(),
        emitMessageUpdate: vi.fn(),
        emitMessageRemoved,
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
          getSession: () => ({ messages: [thinkingRow] }),
          updateMessage: updateMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved: vi.fn(),
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
          getSession: () => ({ messages: [row] }),
          updateMessage: vi.fn(),
          deleteMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved: vi.fn(),
      getActiveSession: () => active,
    });
    local.closeIdlePlaceholders('session', active, { finalize: true });
    expect(deleteMessage).not.toHaveBeenCalled();
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
          getSession: () => ({ messages: [row] }),
          updateMessage: vi.fn(),
          deleteMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved: vi.fn(),
      getActiveSession: () => active,
    });
    local.streamInto('session', active, 'answer', 'delta text');
    active.answerText = '';
    local.closeIdlePlaceholders('session', active, { finalize: true });
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('does not delete a placeholder when retry prior answer text exists', () => {
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
          getSession: () => ({ messages: [row] }),
          updateMessage: vi.fn(),
          deleteMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved: vi.fn(),
      getActiveSession: () => active,
    });
    local.closeIdlePlaceholders('session', active, { finalize: true });
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
          getSession: () => ({ messages: [emptyRow] }),
          updateMessage: vi.fn(),
          deleteMessage,
        }) as never,
      emitMessage: vi.fn(),
      emitMessageUpdate: vi.fn(),
      emitMessageRemoved,
      getActiveSession: () => active,
    });
    local.closeIdlePlaceholders('session', active, { finalize: true });
    expect(deleteMessage).toHaveBeenCalledWith('session', emptyRow.id);
    expect(emitMessageRemoved).toHaveBeenCalledWith('session', emptyRow.id);
  });
});
