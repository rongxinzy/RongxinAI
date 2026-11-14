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
import { ModelCapabilityStatus, ProviderName } from '../../../shared/providers';
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
import type { PiAssistantTranscript } from './piAssistantTranscript';
import type { ActivePiSession } from './piRuntimeSessionState';
import { magpieImageInput } from './piMagpiePiModel';
import {
  imageInputVerdict,
  ImageInputVerdict,
  type ImagePromptPreparation,
} from './piImageInputFallback';

export interface PiRuntimeRecoveryHost {
  getStore(): CoworkStore | null;
  getWorkbench(): WorkbenchTaskService | null;
  readonly transcript: PiAssistantTranscript;
  getActiveSession(sessionId: string): ActivePiSession | undefined;
  activeSessionIds(): Iterable<string>;
  emit(event: string, ...args: unknown[]): void;
  clearToolPermissionsBySession(sessionId: string): void;
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

  /**
   * Keep every live Pi session's declared image capability in step with the
   * user's configured capabilities.
   *
   * Duplicate work is skipped so unchanged sessions are untouched.
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
   * do: let open sessions follow explicit configuration changes.
   */
  async resetImageInputCapabilities(): Promise<void> {
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
    return imageInputVerdict(this.configuredImageInputForActive(active));
  }

  /** Tell the user when configured capabilities prevent sending image bytes. */
  reportOmittedImages(sessionId: string, prepared: ImagePromptPreparation): void {
    if (prepared.omittedImages.length > 0) {
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
    if (active.harnessModelProfile?.provider === ProviderName.Magpie && hasMagpieModelService()) {
      try {
        getMagpieModelService().recordError(rawMessage);
      } catch {
        /* ignore */
      }
    }
    active.errorSurfaced = true;
    active.turnFailed = true;
    active.isRunning = false;
    observeWorkbench(sessionId, () =>
      this.host.getWorkbench()?.failRun(sessionId, { message: rawMessage }),
    );
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

  clearApprovalsBySession(sessionId: string): void {
    this.host.clearToolPermissionsBySession(sessionId);
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
