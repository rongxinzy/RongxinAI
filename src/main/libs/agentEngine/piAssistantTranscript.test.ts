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
});
