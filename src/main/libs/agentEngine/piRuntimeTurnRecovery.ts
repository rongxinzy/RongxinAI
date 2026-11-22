/**
 * Configured image input, deferred turn errors, and in-turn user questions.
 *
 * The adapter still owns session lifetime. These helpers only read the live
 * session map and write the notices the user actually sees.
 */

import { observeWorkbench } from '../../workbenchTask/observe';

import { randomUUID } from 'crypto';

import { classifyCoworkError, type CoworkError } from '../../../common/coworkError';
import type { CoworkMessage, CoworkStore } from '../../coworkStore';
import { ProviderName } from '../../../shared/providers';
import { t } from '../../i18n';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';
import type { MagpieModelService } from '../../magpie/modelService';
import {
  PiAskUserQuestionTimeoutMs,
  PiAskUserQuestionToolName,
  type PiAskUserQuestionInput,
  type PiAskUserQuestionResponse,
} from './piAskUserQuestion';
import type { PiCodingElicitationInput, PiCodingElicitationResponse } from './piCodingElicitation';
import type { PiAssistantTranscript } from './piAssistantTranscript';
import type { ActivePiSession } from './piRuntimeSessionState';
import { isPiCompanionChatSession } from './piRuntimeTypes';
import {
  imageInputVerdict,
  type ImageInputVerdict,
  type ImagePromptPreparation,
} from './piImageInputFallback';

export interface PiRuntimeRecoveryHost {
  getModelService(): MagpieModelService | undefined;
  getStore(sessionId: string): CoworkStore | null;
  getWorkbench(sessionId: string): WorkbenchTaskService | null;
  readonly transcript: PiAssistantTranscript;
  emit(event: string, ...args: unknown[]): void;
  pendingAskUserQuestions: Map<
    string,
    {
      sessionId: string;
      requestedAt: number;
      resolve: (response: PiAskUserQuestionResponse) => void;
      timer: ReturnType<typeof setTimeout>;
      removeAbortListener?: () => void;
    }
  >;
  pendingCodingElicitations: Map<
    string,
    {
      sessionId: string;
      resolve: (response: PiCodingElicitationResponse) => void;
      removeAbortListener?: () => void;
    }
  >;
}

export class PiRuntimeTurnRecovery {
  constructor(private readonly host: PiRuntimeRecoveryHost) {}

  imageInputVerdictForActive(active: ActivePiSession): ImageInputVerdict {
    return imageInputVerdict(active.capabilities.imageInput);
  }

  /** Tell the user when configured capabilities prevent sending image bytes. */
  reportOmittedImages(sessionId: string, prepared: ImagePromptPreparation): void {
    if (prepared.omittedImages.length > 0) {
      const notice = t('coworkImageNotSentNotice');
      if (isPiCompanionChatSession(sessionId)) throw new Error(notice);
      this.appendSystemNotice(sessionId, notice);
    }
  }

  /** Persist and emit a system message — the surface users actually read. */
  private appendSystemNotice(sessionId: string, content: string): void {
    const seed: CoworkMessage = {
      id: randomUUID(),
      type: 'system',
      content,
      timestamp: Date.now(),
    };
    const store = this.host.getStore(sessionId);
    const message = store ? store.messages.addMessage(sessionId, seed) : seed;
    this.host.emit('message', sessionId, message);
  }

  // ── Private: deferred error handling ──
  /**
   * Persist and emit a deferred turn error exactly once.
   *
   * message_end(stopReason=error) only records the error on the session because
   * Pi may auto-retry the turn; this flush runs on auto_retry_end / agent_settled,
   * when the run has genuinely failed. Idempotent — a second call is a no-op.
   */
  flushPendingError(sessionId: string, active: ActivePiSession): void {
    const pending = active.pendingError;
    if (!pending) return;
    active.pendingError = null;
    active.retryStreamReusePending = false;
    if (active.answerText.trim()) {
      this.host.transcript.finalizeMessage(sessionId, active, 'answer', active.answerText);
    } else {
      this.host.transcript.closeIdlePlaceholders(sessionId, active, { finalize: true });
    }
    active.assistantMessageId = null;
    active.thinkingMessageId = null;
    active.answerText = '';
    active.thinkingText = '';
    active.retryPriorAnswer = '';
    this.host.transcript.clearPendingContextUsage(sessionId);
    this.surfaceTurnError(sessionId, active, pending.classified, pending.message);
  }

  /** Persists and emits a turn failure exactly once (bubble + stream error). */
  private surfaceTurnError(
    sessionId: string,
    active: ActivePiSession,
    classified: CoworkError,
    rawMessage: string,
  ): void {
    if (active.harnessModelProfile?.provider === ProviderName.Magpie) {
      try {
        this.host.getModelService()?.recordError(rawMessage);
      } catch {
        /* ignore */
      }
    }
    active.errorSurfaced = true;
    active.turnFailed = true;
    active.isRunning = false;
    this.failWorkbenchRun(sessionId, active.workbenchRunId, rawMessage);
    this.reportSessionError(sessionId, classified);
  }

  failWorkbenchRun(sessionId: string, runId: string | null | undefined, message: string): void {
    if (!runId) return;
    observeWorkbench(sessionId, () =>
      this.host.getWorkbench(sessionId)?.failRun(sessionId, { message }, runId),
    );
  }

  /** An IPC submission may reject after Pi has already reported the same failure. */
  reportRejectedSubmission(sessionId: string, error: unknown): void {
    const rawMessage = error instanceof Error ? error.message : String(error);
    this.reportSessionError(sessionId, classifyCoworkError(rawMessage), { onlyIfChanged: true });
  }

  reportSessionError(sessionId: string, error: CoworkError, { onlyIfChanged = false } = {}): void {
    if (isPiCompanionChatSession(sessionId)) return;
    try {
      const store = this.host.getStore(sessionId);
      if (store) {
        const recorded = store.recordTerminalError(sessionId, error, message => {
          this.host.emit('message', sessionId, message);
        });
        if (onlyIfChanged && !recorded) return;
      } else if (error.message) {
        this.host.emit('message', sessionId, {
          id: randomUUID(),
          type: 'system',
          content: '',
          timestamp: Date.now(),
          metadata: { error: error.message, errorKind: error.kind },
        } satisfies CoworkMessage);
      }
    } catch (persistenceError) {
      console.error(
        `[PiRuntime] Failed to record the error for session ${sessionId}:`,
        persistenceError,
      );
    }
    this.host.emit('error', sessionId, error);
  }

  requestAskUserQuestion(
    sessionId: string,
    toolCallId: string,
    input: PiAskUserQuestionInput,
    signal?: AbortSignal,
  ): Promise<PiAskUserQuestionResponse> {
    if (signal?.aborted) {
      return Promise.resolve({ behavior: 'deny', message: 'The request was cancelled.' });
    }

    const requestId = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.finishAskUserQuestion(requestId, {
          behavior: 'deny',
          message: 'The question timed out without a response.',
        });
      }, PiAskUserQuestionTimeoutMs);

      const onAbort = () => {
        this.finishAskUserQuestion(requestId, {
          behavior: 'deny',
          message: 'The request was cancelled.',
        });
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.host.pendingAskUserQuestions.set(requestId, {
        sessionId,
        requestedAt: performance.now(),
        resolve,
        timer,
        removeAbortListener: () => signal?.removeEventListener('abort', onAbort),
      });

      try {
        this.host.emit('permissionRequest', sessionId, {
          requestId,
          toolName: PiAskUserQuestionToolName,
          toolInput: input as unknown as Record<string, unknown>,
          toolUseId: toolCallId,
        });
      } catch (error) {
        console.error('[PiRuntime] failed to emit AskUserQuestion request:', error);
        this.finishAskUserQuestion(requestId, {
          behavior: 'deny',
          message: 'Unable to show the question to the user.',
        });
      }
    });
  }

  finishAskUserQuestion(requestId: string, response: PiAskUserQuestionResponse): void {
    const pending = this.host.pendingAskUserQuestions.get(requestId);
    if (!pending) return;
    this.host.pendingAskUserQuestions.delete(requestId);
    clearTimeout(pending.timer);
    pending.removeAbortListener?.();
    pending.resolve(response);
    this.host.emit('permissionDismiss', requestId);
  }

  dismissAskUserQuestionsBySession(sessionId: string): void {
    for (const [requestId, pending] of this.host.pendingAskUserQuestions.entries()) {
      if (pending.sessionId === sessionId) {
        this.finishAskUserQuestion(requestId, {
          behavior: 'deny',
          message: 'The session was stopped.',
        });
      }
    }
  }

  dismissCodingElicitationsBySession(sessionId: string, reason: string): void {
    for (const [requestId, pending] of this.host.pendingCodingElicitations.entries()) {
      if (pending.sessionId === sessionId) {
        this.finishCodingElicitation(requestId, { cancelled: true, reason });
      }
    }
  }

  requestCodingElicitation(
    sessionId: string,
    _toolCallId: string,
    input: PiCodingElicitationInput,
    signal?: AbortSignal,
  ): Promise<PiCodingElicitationResponse> {
    const question = input.question.trim();
    if (
      !question ||
      signal?.aborted ||
      [...this.host.pendingCodingElicitations.values()].some(item => item.sessionId === sessionId)
    ) {
      return Promise.resolve({ cancelled: true, reason: 'The coding question was cancelled.' });
    }
    const requestId = randomUUID();
    return new Promise(resolve => {
      const onAbort = () =>
        this.finishCodingElicitation(requestId, {
          cancelled: true,
          reason: 'The coding session was stopped.',
        });
      signal?.addEventListener('abort', onAbort, { once: true });
      this.host.pendingCodingElicitations.set(requestId, {
        sessionId,
        resolve,
        removeAbortListener: () => signal?.removeEventListener('abort', onAbort),
      });
      this.host.emit('codingElicitationRequest', sessionId, { requestId, question });
    });
  }

  finishCodingElicitation(requestId: string, response: PiCodingElicitationResponse): void {
    const pending = this.host.pendingCodingElicitations.get(requestId);
    if (!pending) return;
    this.host.pendingCodingElicitations.delete(requestId);
    pending.removeAbortListener?.();
    pending.resolve(response);
  }
}
