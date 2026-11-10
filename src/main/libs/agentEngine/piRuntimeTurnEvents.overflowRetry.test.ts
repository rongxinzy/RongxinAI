import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CoworkErrorKind } from '../../../common/coworkError';

const hoisted = vi.hoisted(() => ({
  mockCancelPiRetry: vi.fn(async () => undefined),
}));

vi.mock('./piRetryCancellation', () => ({
  cancelPiRetry: hoisted.mockCancelPiRetry,
  waitForPiRetryCancellation: vi.fn(async () => undefined),
}));

import { PiRuntimeTurnEvents, type PiRuntimeTurnHost } from './piRuntimeTurnEvents';
import type { ActivePiSession } from './piRuntimeSessionState';

describe('PiRuntimeTurnEvents - context overflow auto_retry handling', () => {
  let mockHost: PiRuntimeTurnHost;
  let turnEvents: PiRuntimeTurnEvents;
  let activeSession: Partial<ActivePiSession>;

  beforeEach(() => {
    hoisted.mockCancelPiRetry.mockClear();

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
      flushFollowUpQueue: vi.fn(async () => undefined),
      flushPendingError: vi.fn(() => false),
      imageCapabilityConfiguration: vi.fn(() => ({}) as never),
      syncImageInputCapability: vi.fn(async () => undefined),
      createSessionMemoryCompletion: vi.fn(() => ({}) as never),
      recordSummaryOmission: vi.fn(async () => undefined),
    };

    turnEvents = new PiRuntimeTurnEvents(mockHost);

    activeSession = {
      piSession: {} as never,
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
    expect(activeSession.pendingError?.sticky).toBeFalsy();
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
    expect(hoisted.mockCancelPiRetry).not.toHaveBeenCalled();
    expect(activeSession.retryAttempts).toBe(1);
  });

  it('cancels Pi retry for non-transient unrecoverable errors like invalid API key', () => {
    // 1. Simulate fatal auth error
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

    expect(activeSession.pendingError?.sticky).toBe(true);

    // 2. If SDK attempts retry
    turnEvents.handlePiEvent(
      'test-session',
      activeSession as ActivePiSession,
      {
        type: 'auto_retry_start',
        attempt: 1,
      } as never,
    );

    // 3. cancelPiRetry MUST be called to stop hopeless retry loop
    expect(hoisted.mockCancelPiRetry).toHaveBeenCalledOnce();
  });
});
