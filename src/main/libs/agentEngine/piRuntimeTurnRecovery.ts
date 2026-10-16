/**
 * Image-input fallback, deferred turn errors, and in-turn user questions.
 *
 * The adapter still owns session lifetime. These helpers only read the live
 * session map and write the notices the user actually sees.
 */

import { randomUUID } from 'crypto';

import { classifyCoworkError, type CoworkError } from '../../../common/coworkError';
import type { CoworkMessage, CoworkStore } from '../../coworkStore';
import { ModelCapabilityStatus } from '../../../shared/providers';
import { t } from '../../i18n';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { getMagpieModelService, hasMagpieModelService } from '../../magpie/modelService';
import {
  PiAskUserQuestionTimeoutMs,
  PiAskUserQuestionToolName,
  type PiAskUserQuestionInput,
  type PiAskUserQuestionResponse,
} from './piAskUserQuestion';
import type { PiCodingElicitationInput, PiCodingElicitationResponse } from './piCodingElicitation';
import { waitForPiRetryCancellation } from './piRetryCancellation';
import type { PiAssistantTranscript } from './piAssistantTranscript';
import { type ActivePiSession, yieldToEventLoop } from './piRuntimeSessionState';
import type { PiContinueOptions } from './piRuntimeTypes';
import { magpieImageInput } from './piMagpiePiModel';
import {
  buildImageOmittedNotice,
  clearImageInputObservations,
  imageInputVerdict,
  ImageInputVerdict,
  type ImageCapabilityConfiguration,
  type ImagePromptPreparation,
} from './piImageInputFallback';

export interface PiRuntimeRecoveryHost {
  getStore(): CoworkStore | null;
  getWorkbench(): WorkbenchTaskService | null;
  readonly transcript: PiAssistantTranscript;
  getActiveSession(sessionId: string): ActivePiSession | undefined;
  activeSessionIds(): Iterable<string>;
  deleteActiveSession(sessionId: string): void;
  emit(event: string, ...args: unknown[]): void;
  continueSession(sessionId: string, prompt: string, options?: PiContinueOptions): Promise<void>;
  ocrCommandFor(): ((imagePath: string) => string) | undefined;
  approvalSessionMap: Map<string, string>;
  pendingAskUserQuestions: Map<
    string,
    {
      sessionId: string;
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

  // ── Private: image input fallback ──
  /** Whether the current turn may carry image bytes (see piImageInputFallback). */
  /**
   * Configured image capability as it stands right now.
   *
   * A session's capabilities are a snapshot from the last model resolution, so
   * after the user edits provider settings they must not be trusted: the next
   * turn, and any capability sync, have to read the current configuration.
   * When the configuration cannot be read the snapshot is the best available
   * answer, and withholding images stays the conservative outcome.
   */
  private configuredImageInputForActive(active: ActivePiSession): ModelCapabilityStatus {
    const modelId = typeof active.model.id === 'string' ? active.model.id : '';
    if (hasMagpieModelService() && modelId) {
      const projected = getMagpieModelService().peekModel(modelId);
      if (projected) return magpieImageInput(projected);
    }
    return active.capabilities.imageInput;
  }

  /** Configuration half of the image-capability fingerprint, in one shape. */
  imageCapabilityConfiguration(active: ActivePiSession): ImageCapabilityConfiguration {
    const imageInput = this.configuredImageInputForActive(active);
    return {
      imageInput,
      supportsImage: imageInput === ModelCapabilityStatus.Supported,
      endpointKey: active.imageEndpointKey,
    };
  }

  /**
   * Keep every live Pi session's declared image capability in step with the
   * effective verdict.
   *
   * The verdict can change while sessions are open — a rejection is learned, or
   * the user edits provider settings — and a stale snapshot would either drop
   * images the host still sends, or keep sending images the server already
   * refused. Duplicate work is skipped so an unchanged session is untouched.
   */
  async syncImageInputCapability(sessionIds?: Iterable<string>): Promise<void> {
    const targets = sessionIds ? [...sessionIds] : [...this.host.activeSessionIds()];
    await Promise.allSettled(
      targets.map(async sessionId => {
        const active = this.host.getActiveSession(sessionId);
        if (!active) return;
        const input: Array<'text' | 'image'> =
          this.imageInputVerdictForActive(active) === ImageInputVerdict.Supported
            ? ['text', 'image']
            : ['text'];
        const current = Array.isArray(active.model.input) ? active.model.input : [];
        if (current.length === input.length && current.every((value, i) => value === input[i])) {
          return;
        }
        const model = { ...active.model, input };
        try {
          await active.piSession.setModel(model);
          active.model = model;
        } catch (error) {
          console.warn(`[PiRuntime] could not update image input for session ${sessionId}:`, error);
        }
      }),
    );
  }

  /**
   * Provider/model settings are the user's statement about what the models can
   * do: drop the runtime observations and let open sessions follow immediately.
   */
  async resetImageInputCapabilities(): Promise<void> {
    clearImageInputObservations();
    if (hasMagpieModelService()) {
      try {
        await getMagpieModelService().catalog();
      } catch (error) {
        console.warn('[PiRuntime] could not refresh model image capabilities:', error);
      }
    }
    await this.syncImageInputCapability();
  }

  imageInputVerdictForActive(active: ActivePiSession): ImageInputVerdict {
    return imageInputVerdict(
      this.configuredImageInputForActive(active),
      active.harnessModelProfile.provider,
      active.harnessModelProfile.model,
      this.imageCapabilityConfiguration(active),
    );
  }

  /**
   * Records what happened to this turn's image attachments, so a failure can be
   * retried as text, and tells the user when images were withheld: a text-only
   * turn must never look like the image was delivered.
   */
  recordImagePrompt(
    sessionId: string,
    active: ActivePiSession,
    text: string,
    prepared: ImagePromptPreparation,
  ): void {
    active.imageRetryPending = false;
    active.imageRejectionHandled = false;
    // Image state is recorded whether or not the turn carried text: an
    // image-only submission is a normal turn, and the failure path has to be
    // able to retry it.
    active.lastImagePrompt =
      prepared.sentImages.length > 0 || prepared.omittedImages.length > 0
        ? {
            text,
            sentImages: prepared.sentImages,
            omittedImages: prepared.omittedImages,
            retried: false,
          }
        : null;
    if (active.lastImagePrompt && prepared.omittedImages.length > 0) {
      this.appendSystemNotice(sessionId, t('coworkImageNotSentNotice'));
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
    const store = this.host.getStore();
    const message = store ? store.addMessage(sessionId, seed) : seed;
    this.host.emit('message', sessionId, message);
  }

  // ── Private: deferred error handling ──
  /**
   * Persist and emit a deferred turn error exactly once.
   *
   * message_end(stopReason=error) only records the error on the session because
   * Pi may auto-retry the turn; this flush runs on auto_retry_end / agent_settled,
   * when the run has genuinely failed. Idempotent — a second call is a no-op.
   *
   * Returns true when it scheduled a text-only retry of an image rejection
   * instead of surfacing the error; the caller must then skip its own
   * post-failure work (queue draining, completion).
   */
  flushPendingError(sessionId: string, active: ActivePiSession): boolean {
    const pending = active.pendingError;
    if (!pending) return false;
    const fallback = active.lastImagePrompt;
    // A turn that carried images whose payload the provider rejected is an image
    // rejection no matter how often the SDK retried it: the user's capability
    // setting stays as configured, the model gets the file paths, and a repeated
    // failure must not resurface as a misleading generic error.
    const imageTurnError =
      active.imageRejectionHandled && fallback !== null && fallback.sentImages.length > 0;
    if (imageTurnError && fallback) {
      active.pendingError = null;
      active.imageRetryPending = false;
      if (!fallback.retried) {
        this.retryTurnWithoutImages(sessionId, active, fallback);
        return true;
      }
      // Already retried once: the retry replaces this turn's outcome.
      active.turnFailed = false;
      active.isRunning = false;
      return true;
    }
    active.pendingError = null;
    if (active.answerText.trim()) {
      this.host.transcript.finalizeMessage(sessionId, active, 'answer', active.answerText);
      active.assistantMessageId = null;
      active.answerText = '';
    }
    this.surfaceTurnError(sessionId, active, pending.classified, pending.message);
    return false;
  }

  /**
   * Re-sends the failed turn as text, with the image paths in the prompt, after
   * an image payload rejection. The capability configuration is untouched.
   */
  private retryTurnWithoutImages(
    sessionId: string,
    active: ActivePiSession,
    fallback: NonNullable<ActivePiSession['lastImagePrompt']>,
  ): void {
    active.lastImagePrompt = { ...fallback, retried: true };
    active.errorSurfaced = false;
    active.turnFailed = false;
    active.isRunning = true;
    this.appendSystemNotice(sessionId, t('coworkImageRetryNotice'));
    const retryPrompt = [
      fallback.text,
      buildImageOmittedNotice(fallback.sentImages, {
        verdict: ImageInputVerdict.Rejected,
        ocrCommandFor: this.host.ocrCommandFor(),
      }),
    ]
      .filter(content => content.trim().length > 0)
      .join('\n\n');
    void (async () => {
      try {
        // The SDK may already be aborting its own retry of the rejected payload;
        // continuing before it settles would race that run. Its failure is
        // already explained by the notice above, so it must not escape here.
        await waitForPiRetryCancellation(active.piSession);
      } catch {
        // Intentionally ignored: the cancelled attempt's error is not the user's.
      }
      // Let the cancellation bookkeeping clear before continuing: continueSession
      // awaits the same promise and would rethrow this already-failed attempt.
      await yieldToEventLoop();
      // A run that failed hard leaves its Pi session unable to accept another
      // prompt (the SDK swallows it), so the retry drops the session and lets
      // continueSession rebuild it from the stored transcript. The rebuild starts
      // a fresh session, so the session-scoped approval settings travel with it —
      // otherwise an "allow all" session would start asking for every tool call.
      const approvalMode = active.approvalMode;
      this.host.deleteActiveSession(sessionId);
      try {
        await this.host.continueSession(sessionId, retryPrompt, {
          _skipUserMessage: true,
          approvalMode,
        });
      } catch (error) {
        console.warn(`[PiRuntime] image fallback retry failed for session ${sessionId}:`, error);
        const message = error instanceof Error ? error.message : String(error);
        const current = this.host.getActiveSession(sessionId) ?? active;
        this.surfaceTurnError(sessionId, current, classifyCoworkError(message), message);
      }
    })();
  }

  /** Persists and emits a turn failure exactly once (bubble + stream error). */
  private surfaceTurnError(
    sessionId: string,
    active: ActivePiSession,
    classified: CoworkError,
    rawMessage: string,
  ): void {
    active.errorSurfaced = true;
    active.turnFailed = true;
    active.isRunning = false;
    this.host.getWorkbench()?.failRun?.(sessionId, { message: rawMessage });
    // Persist a system error message so the error survives session switching
    // and is visible in the message list. The classified kind lets the renderer
    // translate it into a user-friendly i18n message; the raw message is kept
    // for console diagnostics only.
    const errorMessageSeed: CoworkMessage = {
      id: randomUUID(),
      type: 'system',
      content: '',
      timestamp: Date.now(),
      metadata: { error: rawMessage, errorKind: classified.kind },
    };
    let errorMessage = errorMessageSeed;
    const store = this.host.getStore();
    if (store) {
      store.updateSession(sessionId, { status: 'error' });
      errorMessage = store.addMessage(sessionId, errorMessageSeed);
    }
    this.host.emit('message', sessionId, errorMessage);
    this.host.emit('error', sessionId, classified);
  }

  /**
   * Ends the turn when a workbench run can no longer execute tools. The run is
   * already failed, so every further tool call is denied: without ending the
   * turn the model answers each denial with another tool call.
   *
   * The error is flushed immediately so the user sees the concrete reason
   * instead of a turn that silently stops producing output.
   */
  endTerminatedWorkbenchTurn(sessionId: string, message: string): void {
    const active = this.host.getActiveSession(sessionId);
    if (!active || active.aborted || active.turnFailed) return;
    console.warn(`[PiRuntime] ending the turn of session ${sessionId}: ${message}`);
    active.pendingError = { message, classified: classifyCoworkError(message) };
    active.piSession.abortBash();
    void active.piSession.abort().catch((error: unknown) => {
      console.warn('[PiRuntime] failed to abort a terminated workbench run:', error);
    });
    this.flushPendingError(sessionId, active);
  }

  clearApprovalsBySession(sessionId: string): void {
    for (const [requestId, sid] of this.host.approvalSessionMap.entries()) {
      if (sid !== sessionId) continue;
      this.host.approvalSessionMap.delete(requestId);
      this.host.emit('permissionDismiss', requestId);
    }
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
