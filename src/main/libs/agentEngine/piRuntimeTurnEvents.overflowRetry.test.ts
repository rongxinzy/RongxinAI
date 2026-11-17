import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CoworkErrorKind } from '../../../common/coworkError';

import { PiRuntimeTurnEvents, type PiRuntimeTurnHost } from './piRuntimeTurnEvents';
import type { ActivePiSession } from './piRuntimeSessionState';
import { PiAgentEventType, PiCompactionReason } from './piStreamConstants';
import { PiAssistantStopReason } from './piToolConstants';

describe('PiRuntimeTurnEvents - context overflow auto_retry handling', () => {
  let mockHost: PiRuntimeTurnHost;
  let turnEvents: PiRuntimeTurnEvents;
  let activeSession: Partial<ActivePiSession>;

  beforeEach(() => {
    mockHost = {
      getStore: vi.fn(() => null),
      getWorkbench: vi.fn(() => null),
      transcript: {
        closeIdlePlaceholders: vi.fn(),
        finalizeActiveThinking: vi.fn(),
        streamInto: vi.fn(),
      } as never,
      sessionCount: vi.fn(() => 1),
      activeSessions: vi.fn(() => []),
      getActiveSession: vi.fn(() => activeSession as ActivePiSession),
      emit: vi.fn(),
      stopActiveSession: vi.fn(),
      flushControlActions: vi.fn(async () => undefined),
      flushPendingError: vi.fn(() => false),
      createSessionMemoryCompletion: vi.fn(() => ({}) as never),
      recordSummaryOmission: vi.fn(async () => undefined),
    };

    turnEvents = new PiRuntimeTurnEvents(mockHost);

    activeSession = {
      piSession: { abort: vi.fn() } as never,
      pendingError: null,
      errorSurfaced: false,
      turnFailed: false,
      retryStreamReusePending: false,
      retryAttempts: 0,
      retryNoticeEmitted: false,
      streamAccumulator: {
        reconcile: vi.fn(() => ({ text: '', thinking: '' })),
        reset: vi.fn(),
        clearTurnState: vi.fn(),
      } as never,
      piTranslatorState: {} as never,
      harnessModelProfile: {
        provider: 'test',
        model: 'test-model',
        reasoningProfile: 'default',
        workflowKind: 'cowork',
        harnessVersion: '1.0.0',
      },
      writeTokenLimitRecovery: {
        queueIfNeeded: vi.fn(),
        tryRecoverTurn: vi.fn(),
        resetForTurn: vi.fn(),
      } as never,
      thinkingLifecycle: {
        markContentStreaming: vi.fn(),
        reset: vi.fn(),
      } as never,
    };
  });

  it('does NOT mark InputTooLong context overflow as sticky error', () => {
    const overflowErrorMessage =
      'Invalid request: prompt is too long. context length exceeded: maximum context length is 8192 tokens';

    turnEvents.handlePiEvent(
      'test-session',
      activeSession as ActivePiSession,
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: overflowErrorMessage,
        },
      } as never,
    );

    expect(activeSession.pendingError).toBeDefined();
    expect(activeSession.pendingError?.classified.kind).toBe(CoworkErrorKind.InputTooLong);
  });

  it('does NOT cancel Pi retry when auto_retry_start arrives on context overflow', () => {
    // 1. Simulate context overflow error on message_end
    const overflowErrorMessage = 'HTTP 400: context_length_exceeded';
    turnEvents.handlePiEvent(
      'test-session',
      activeSession as ActivePiSession,
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: overflowErrorMessage,
        },
      } as never,
    );

    expect(activeSession.pendingError?.classified.kind).toBe(CoworkErrorKind.InputTooLong);

    // 2. Pi initiates auto-compaction and retry
    turnEvents.handlePiEvent(
      'test-session',
      activeSession as ActivePiSession,
      {
        type: 'auto_retry_start',
        attempt: 1,
      } as never,
    );

    // 3. cancelPiRetry must NOT have been called!
    expect(activeSession.piSession!.abort).not.toHaveBeenCalled();
    expect(activeSession.retryAttempts).toBe(1);
  });

  it('defers to Pi native retry policy for non-image errors like invalid API key', () => {
    const authErrorMessage = 'Unauthorized: invalid api key provided';
    turnEvents.handlePiEvent(
      'test-session',
      activeSession as ActivePiSession,
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: authErrorMessage,
        },
      } as never,
    );

    turnEvents.handlePiEvent(
      'test-session',
      activeSession as ActivePiSession,
      {
        type: 'auto_retry_start',
        attempt: 1,
      } as never,
    );

    expect(activeSession.piSession!.abort).not.toHaveBeenCalled();
  });

  it('leaves image capability rejection retry to Pi', () => {
    turnEvents.handlePiEvent(
      'test-session',
      activeSession as ActivePiSession,
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'image input is not supported for this model',
        },
      } as never,
    );

    turnEvents.handlePiEvent(
      'test-session',
      activeSession as ActivePiSession,
      {
        type: 'auto_retry_start',
        attempt: 1,
      } as never,
    );

    expect(activeSession.piSession!.abort).not.toHaveBeenCalled();
  });

  it('surfaces the summary failure at settlement without completing or cancelling native recovery', () => {
    turnEvents.handlePiEvent('test-session', activeSession as ActivePiSession, {
      type: PiAgentEventType.CompactionEnd,
      reason: PiCompactionReason.Overflow,
      errorMessage: 'Auto-compaction failed: summary unavailable',
    });
    expect(activeSession.pendingError?.message).toContain('summary unavailable');

    expect(mockHost.flushPendingError).not.toHaveBeenCalled();
    expect(activeSession.piSession!.abort).not.toHaveBeenCalled();
    turnEvents.handlePiEvent('test-session', activeSession as ActivePiSession, {
      type: PiAgentEventType.AgentSettled,
    });
    expect(mockHost.flushPendingError).toHaveBeenCalledOnce();
    expect(mockHost.emit).not.toHaveBeenCalledWith('complete', expect.anything());
  });

  it('does not turn completed work into failure because subsequent maintenance failed', () => {
    activeSession.lastAssistantMessage = {
      role: 'assistant',
      stopReason: PiAssistantStopReason.Stop,
    };
    turnEvents.handlePiEvent('test-session', activeSession as ActivePiSession, {
      type: PiAgentEventType.CompactionEnd,
      reason: PiCompactionReason.Threshold,
      errorMessage: 'Auto-compaction failed: summary unavailable',
    });
    expect(activeSession.pendingError).toBeNull();
    expect(activeSession.turnFailed).toBe(false);
  });

  it.each([
    { reason: PiCompactionReason.Manual, aborted: false },
    { reason: PiCompactionReason.Overflow, aborted: true },
  ])('does not poison the turn for manual compaction or cancellation: %j', event => {
    turnEvents.handlePiEvent('test-session', activeSession as ActivePiSession, {
      type: PiAgentEventType.CompactionEnd,
      ...event,
      errorMessage: 'Compaction cancelled',
    });
    expect(activeSession.pendingError).toBeNull();
    expect(activeSession.turnFailed).toBe(false);
    expect(activeSession.piSession!.abort).not.toHaveBeenCalled();
  });
});
