import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CoworkErrorKind } from '../src/common/coworkError';
import { setLanguage } from '../src/main/i18n';
import {
  LlamaCppAgentEligibilityReason,
  type LlamaCppAgentModelEligibility,
} from '../src/shared/llamacpp';
import { ProviderName } from '../src/shared/providers';
import type { NvidiaSmiSnapshot } from '../src/shared/hardware';

// ── Hoisted mocks for LlamaCpp Running Model Registry ────────────────────────
const hoistedRegistry = vi.hoisted(() => ({
  isLlamaCppModelRunning: vi.fn(),
  getLlamaCppModelAgentEligibility: vi.fn(),
}));

vi.mock('../src/main/libs/llamacppRunningModelRegistry', () => ({
  isLlamaCppModelRunning: hoistedRegistry.isLlamaCppModelRunning,
  getLlamaCppModelAgentEligibility: hoistedRegistry.getLlamaCppModelAgentEligibility,
}));

// ── Hoisted mocks for Pi Retry Cancellation ──────────────────────────────────
const hoistedRetry = vi.hoisted(() => ({
  cancelPiRetry: vi.fn(async () => undefined),
  waitForPiRetryCancellation: vi.fn(async () => undefined),
}));

vi.mock('../src/main/libs/agentEngine/piRetryCancellation', () => ({
  cancelPiRetry: hoistedRetry.cancelPiRetry,
  waitForPiRetryCancellation: hoistedRetry.waitForPiRetryCancellation,
}));

import {
  assertLlamaCppWorkModeContext,
  assertWorkModeContextWindow,
  WORK_MODE_MIN_CONTEXT_WINDOW,
} from '../src/main/libs/llamacppWorkModeContextGuard';
import { resolveAutomaticLlamaCppContextSize } from '../src/shared/llamacpp/defaults';
import {
  PiRuntimeTurnEvents,
  type PiRuntimeTurnHost,
} from '../src/main/libs/agentEngine/piRuntimeTurnEvents';
import type { ActivePiSession } from '../src/main/libs/agentEngine/piRuntimeSessionState';

describe('Empirical Verification Harness — Context Window Guard, Sizing & Auto-Retry', () => {
  beforeEach(() => {
    setLanguage('en');
    hoistedRegistry.isLlamaCppModelRunning.mockReset();
    hoistedRegistry.getLlamaCppModelAgentEligibility.mockReset();
    hoistedRetry.cancelPiRetry.mockClear();
    hoistedRetry.waitForPiRetryCancellation.mockClear();
  });

  // Suite 3: Event flow & cancellation matrix in piRuntimeTurnEvents
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Suite 3: Event Flow in piRuntimeTurnEvents', () => {
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
          finalizeMessage: vi.fn(),
          scheduleContextUsageSync: vi.fn(),
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
        piSession: { id: 'test-pi-session' } as never,
        pendingError: null,
        errorSurfaced: false,
        turnFailed: false,
        retryStreamReusePending: false,
        retryAttempts: 0,
        retryNoticeEmitted: false,
        thinkingText: '',
        answerText: '',
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

    const errorScenarios = [
      // 1. Context overflow errors (must NOT be sticky, must NOT be cancelled on auto_retry_start)
      {
        name: 'Context overflow HTTP 400',
        rawError: 'HTTP 400: context_length_exceeded: maximum context length is 8192 tokens',
        expectedKind: CoworkErrorKind.InputTooLong,
        expectSticky: false,
        expectCancelledOnRetry: false,
      },
      {
        name: 'Prompt too long HTTP 413',
        rawError:
          'Invalid request: prompt is too long. context length exceeded: maximum context length is 8192 tokens',
        expectedKind: CoworkErrorKind.InputTooLong,
        expectSticky: false,
        expectCancelledOnRetry: false,
      },
      {
        name: 'OpenAI Range of input length overflow',
        rawError:
          'The request was rejected because the range of input length exceeds maximum 32768',
        expectedKind: CoworkErrorKind.InputTooLong,
        expectSticky: false,
        expectCancelledOnRetry: false,
      },

      // 2. Client-side error classification leaves non-image retry eligibility to Pi
      {
        name: 'Invalid API Key (AuthExpired)',
        rawError: 'Unauthorized: invalid api key provided',
        expectedKind: CoworkErrorKind.AuthExpired,
        expectSticky: false,
        expectCancelledOnRetry: false,
      },
      {
        name: 'Model Not Found (ModelNotFound)',
        rawError: 'The model `deepseek-chat-nonexistent` does not exist',
        expectedKind: CoworkErrorKind.ModelNotFound,
        expectSticky: false,
        expectCancelledOnRetry: false,
      },
      {
        name: 'Quota / Budget Exceeded (BudgetExceeded)',
        rawError:
          'You have exceeded your current quota, please check your plan and billing details',
        expectedKind: CoworkErrorKind.BudgetExceeded,
        expectSticky: false,
        expectCancelledOnRetry: false,
      },
      // 3. Image capability rejections stay sticky and cancel SDK retries
      {
        name: 'Model Capability Unsupported',
        rawError: 'image input is not supported for this model',
        expectedKind: CoworkErrorKind.ModelCapabilityUnsupported,
        expectSticky: true,
        expectCancelledOnRetry: true,
      },

      // 3. Transient auto-retryable errors (sticky = false, retry allowed)
      {
        name: 'Rate Limit 429 (RateLimited)',
        rawError: 'HTTP 429: Too Many Requests. rate limit exceeded',
        expectedKind: CoworkErrorKind.RateLimited,
        expectSticky: false,
        expectCancelledOnRetry: false,
      },
      {
        name: 'Upstream Server Error 502 (ServerError)',
        rawError: 'HTTP 502: Bad Gateway',
        expectedKind: CoworkErrorKind.ServerError,
        expectSticky: false,
        expectCancelledOnRetry: false,
      },
    ];

    it.each(errorScenarios)(
      'evaluates error scenario "$name" -> kind=$expectedKind sticky=$expectSticky cancelled=$expectCancelledOnRetry',
      scenario => {
        // Step 1: Simulate error event on message_end
        turnEvents.handlePiEvent(
          'session-1',
          activeSession as ActivePiSession,
          {
            type: 'message_end',
            message: {
              role: 'assistant',
              stopReason: 'error',
              errorMessage: scenario.rawError,
            },
          } as never,
        );

        // Verify classification
        expect(activeSession.pendingError).toBeDefined();
        expect(activeSession.pendingError?.classified.kind).toBe(scenario.expectedKind);

        // Verify sticky flag
        if (scenario.expectSticky) {
          expect(activeSession.pendingError?.sticky).toBe(true);
        } else {
          expect(activeSession.pendingError?.sticky).toBeFalsy();
        }

        // Step 2: Simulate auto_retry_start from Pi SDK
        turnEvents.handlePiEvent(
          'session-1',
          activeSession as ActivePiSession,
          {
            type: 'auto_retry_start',
            attempt: 1,
          } as never,
        );

        // Verify whether cancelPiRetry was invoked
        if (scenario.expectCancelledOnRetry) {
          expect(hoistedRetry.cancelPiRetry).toHaveBeenCalledOnce();
        } else {
          expect(hoistedRetry.cancelPiRetry).not.toHaveBeenCalled();
          expect(activeSession.retryAttempts).toBe(1);
        }
      },
    );

    it('clears pendingError on successful retry message_end', () => {
      // 1. Initial overflow error
      turnEvents.handlePiEvent(
        'session-1',
        activeSession as ActivePiSession,
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason: 'error',
            errorMessage: 'HTTP 400: context_length_exceeded',
          },
        } as never,
      );
      expect(activeSession.pendingError).not.toBeNull();

      // 2. Pi retries
      turnEvents.handlePiEvent(
        'session-1',
        activeSession as ActivePiSession,
        {
          type: 'auto_retry_start',
          attempt: 1,
        } as never,
      );

      // 3. Retry succeeds: message_end with normal stop
      turnEvents.handlePiEvent(
        'session-1',
        activeSession as ActivePiSession,
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason: 'stop',
            content: [{ type: 'text', text: 'Compacted response succeeded!' }],
          },
        } as never,
      );

      // Pending error should be cleared!
      expect(activeSession.pendingError).toBeNull();
      expect(activeSession.turnFailed).toBe(false);
    });
  });
});
