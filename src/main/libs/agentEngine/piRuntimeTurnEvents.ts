/**
 * Maps Pi session events onto Cowork messages, tool activity, and run completion.
 *
 * Completion stays on agent_settled. The adapter still owns session lifetime,
 * approvals, and the follow-up queue.
 */

import { randomUUID } from 'crypto';

import {
  classifyCoworkError,
  CoworkErrorKind,
  isTransient,
  makeCoworkError,
} from '../../../common/coworkError';
import type { CoworkMessage } from '../../coworkStore';
import { CoworkToolActivityPhase } from '../../../shared/cowork/toolActivity';
import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import { agentResourceDiagnostics } from '../../agentResourceDiagnostics';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { cancelPiRetry } from './piRetryCancellation';
import { PiAssistantEventType } from './piStreamConstants';
import { PiSubagentToolName } from './piSubagentTool';
import { invalidatesPiFinalResponse, isPiFinalResponse } from './piFinalResponse';
import { settlePiWorkbenchCompletion } from './piWorkbenchCompletion';
import {
  imageCapabilityFingerprint,
  isImageCapabilityError,
  isImagePayloadRejection,
  markImageInputRejected,
  type ImageCapabilityConfiguration,
} from './piImageInputFallback';
import { getPiPreparingToolActivity, toToolActivityInput } from './toolActivity';
import type { PiAssistantTranscript } from './piAssistantTranscript';
import type { ActivePiSession, PiEvent, PiStartupLatency } from './piRuntimeSessionState';
import type { SessionMemoryCompletion } from '../../memory/sessionMemoryExtractor';

export interface PiRuntimeTurnHost {
  getStore(): import('../../coworkStore').CoworkStore | null;
  getWorkbench(): WorkbenchTaskService | null;
  readonly transcript: PiAssistantTranscript;
  sessionCount(): number;
  activeSessions(): ActivePiSession[];
  getActiveSession(sessionId: string): ActivePiSession | undefined;
  emit(event: string, ...args: unknown[]): void;
  stopActiveSession(
    sessionId: string,
    reason: string,
    drainQueuedFollowUp: boolean,
    cause?: CoworkInterruptionCause,
  ): void;
  flushFollowUpQueue(sessionId: string, active: ActivePiSession): Promise<void>;
  flushPendingError(sessionId: string, active: ActivePiSession): boolean;
  imageCapabilityConfiguration(active: ActivePiSession): ImageCapabilityConfiguration;
  syncImageInputCapability(sessionIds?: Iterable<string>): Promise<void>;
  createSessionMemoryCompletion(active: ActivePiSession): SessionMemoryCompletion;
  runPostTurnMemoryMaintenance(
    sessionId: string,
    workingDirectory: string,
    complete: SessionMemoryCompletion,
  ): Promise<void>;
}

export class PiRuntimeTurnEvents {
  constructor(private readonly host: PiRuntimeTurnHost) {}

  // ── Private: event mapping ──

  private recordFirstVisibleToken(sessionId: string, active: ActivePiSession): void {
    const firstTokenAt = active.firstVisibleTextAt ?? Date.now();
    active.firstVisibleTextAt = firstTokenAt;
    if (active.startupLatencyRecorded || active.agentStartedAt === null) return;

    const startupLatency: PiStartupLatency = {
      sessionCreatedAt: active.piSessionCreatedAt,
      agentStartedAt: active.agentStartedAt,
      firstTokenAt,
      sessionCreateToAgentStartMs: Math.max(0, active.agentStartedAt - active.piSessionCreatedAt),
      agentStartToFirstTokenMs: Math.max(0, firstTokenAt - active.agentStartedAt),
      sessionCreateToFirstTokenMs: Math.max(0, firstTokenAt - active.piSessionCreatedAt),
    };
    active.startupLatency = startupLatency;
    active.startupLatencyRecorded = true;
    console.log(
      `[PiRuntime] startup latency for ${sessionId}: ` +
        `create-to-agent_start=${startupLatency.sessionCreateToAgentStartMs}ms, ` +
        `agent_start-to-first_token=${startupLatency.agentStartToFirstTokenMs}ms, ` +
        `create-to-first_token=${startupLatency.sessionCreateToFirstTokenMs}ms`,
    );
  }

  handlePiEvent(sessionId: string, active: ActivePiSession, event: PiEvent): void {
    // Late events from an aborted turn must not touch state.
    if (active.aborted) return;
    // Debug: log all Pi events to diagnose frontend rendering issues
    if (event.type !== 'message_update') {
      console.log(
        '[PiRuntime] Event:',
        event.type,
        event.message?.role ? `role=${event.message.role}` : '',
        event.message?.stopReason ? `stopReason=${event.message.stopReason}` : '',
      );
    }
    switch (event.type) {
      case 'agent_start':
        active.isRunning = true;
        active.lastUsedAt = Date.now();
        this.host.getStore()?.updateSession(sessionId, { status: 'running' });
        if (active.agentStartedAt === null) {
          active.agentStartedAt = Date.now();
          console.log(
            `[PiRuntime] agent_start for ${sessionId} after ${active.agentStartedAt - active.piSessionCreatedAt}ms from Pi session creation`,
          );
        }
        this.host.emit('started', sessionId);
        break;

      case 'turn_start':
        active.isRunning = true;
        active.lastUsedAt = Date.now();
        active.toolStartedAtByCallId.clear();
        active.preparingToolCallIdByContentIndex.clear();
        {
          const clearActivity = active.toolActivityTracker.clear();
          if (clearActivity) this.host.emit('toolActivity', sessionId, clearActivity);
        }
        // New turn → fresh answer + thinking messages, created lazily on first content.
        active.assistantMessageId = null;
        active.thinkingMessageId = null;
        active.answerText = '';
        active.thinkingText = '';
        active.streamAccumulator.reset();
        active.thinkingLifecycle.reset();
        break;

      case 'message_start':
        active.requestStartedAt = Date.now();
        active.firstVisibleTextAt = null;
        break;

      case 'message_update': {
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent?.type.startsWith('toolcall_')) {
          const contentIndex = assistantEvent.contentIndex ?? -1;
          const fallbackToolCallId =
            active.preparingToolCallIdByContentIndex.get(contentIndex) ??
            `pi-preparing:${event.message?.id ?? sessionId}:${contentIndex}`;
          const activity = getPiPreparingToolActivity(assistantEvent, fallbackToolCallId);
          if (activity) {
            const previousToolCallId = active.preparingToolCallIdByContentIndex.get(contentIndex);
            if (previousToolCallId && previousToolCallId !== activity.toolCallId) {
              const removeEvent = active.toolActivityTracker.remove(previousToolCallId);
              if (removeEvent) this.host.emit('toolActivity', sessionId, removeEvent);
            }
            active.preparingToolCallIdByContentIndex.set(contentIndex, activity.toolCallId);
            const activityEvent = active.toolActivityTracker.upsert(activity);
            if (activityEvent) this.host.emit('toolActivity', sessionId, activityEvent);
          }
        }
        // Pi 0.84 emits fine-grained assistantMessageEvent deltas. Keep support
        // for older cumulative snapshots, then reconcile against message_end.
        const { text, thinking } = active.streamAccumulator.update(
          event.assistantMessageEvent,
          event.message,
        );
        const segmentEventType = event.assistantMessageEvent?.type;
        const thinkingEnded = segmentEventType === PiAssistantEventType.ThinkingEnd;
        if (segmentEventType === PiAssistantEventType.ThinkingDelta) {
          active.thinkingLifecycle.start();
        } else if (thinkingEnded) {
          active.thinkingLifecycle.finish();
        }
        if (thinking && thinking !== active.thinkingText) {
          active.thinkingText = thinking;
          if (!thinkingEnded) active.thinkingLifecycle.start();
          this.host.transcript.streamInto(sessionId, active, 'thinking', thinking);
        }
        if (thinkingEnded) {
          this.host.transcript.finalizeActiveThinking(sessionId, active);
        }
        if (text && text !== active.answerText) {
          this.recordFirstVisibleToken(sessionId, active);
          this.host.transcript.finalizeActiveThinking(sessionId, active);
          active.answerText = text;
          this.host.transcript.streamInto(sessionId, active, 'answer', text);
        }
        break;
      }

      case 'message_end': {
        if (event.message?.role === 'assistant') {
          active.writeTokenLimitRecovery.queueIfNeeded(event.message, active.piSession);
          if (event.message.stopReason === 'error') {
            // The turn was already reported as failed (non-retryable error).
            if (active.errorSurfaced) return;
            const { text, thinking } = active.streamAccumulator.reconcile(event.message);
            if (thinking && thinking !== active.thinkingText) {
              active.thinkingText = thinking;
              active.thinkingLifecycle.markContentStreaming();
            }
            if (text) {
              active.answerText = text;
              this.recordFirstVisibleToken(sessionId, active);
            }
            this.host.transcript.finalizeActiveThinking(sessionId, active);
            const errMsg = event.message.errorMessage || 'Pi agent error';
            const errDetail = event.message.content
              ? typeof event.message.content === 'string'
                ? event.message.content
                : JSON.stringify(event.message.content)
              : '(no content)';
            console.error('[PiRuntime] Assistant error:', errMsg, 'detail:', errDetail);
            // Defer surfacing: Pi may auto-retry this turn (auto_retry_start).
            // Persisting/emitting here would produce one error bubble per failed
            // attempt — flushPendingError surfaces the error exactly once when
            // the run settles (auto_retry_end / agent_settled).
            const classified = classifyCoworkError(errMsg);
            const carriedImages = (active.lastImagePrompt?.sentImages.length ?? 0) > 0;
            // A 400-class rejection of a turn that actually carried images is an
            // image-capability rejection even when the server wording misses the
            // textual rules (see piImageInputFallback).
            const imageRejection =
              classified.kind === CoworkErrorKind.ModelCapabilityUnsupported
                ? // Only image rejections are corrected: an audio/video capability
                  // error must not silently strip the model's image-input verdict,
                  // and a payload problem must not either.
                  isImageCapabilityError(errMsg)
                : isImagePayloadRejection(errMsg, carriedImages);
            active.pendingError = {
              message: errMsg,
              classified: imageRejection
                ? makeCoworkError(CoworkErrorKind.ModelCapabilityUnsupported, errMsg)
                : classified,
            };
            active.turnFailed = true;
            // A failed turn leaves its bubble behind too; a retry streams into the
            // same id and flips the flag back on by itself.
            this.host.transcript.closeIdlePlaceholders(sessionId, active);
            if (
              !active.errorSurfaced &&
              active.pendingError.classified.kind !== CoworkErrorKind.Unknown &&
              !isTransient(active.pendingError.classified.kind)
            ) {
              // Keep the original failure until Pi settles. If the SDK retries,
              // auto_retry_start cancels its newly installed backoff controller.
              active.pendingError.sticky = true;
            }
            if (imageRejection) {
              // Keep the rejection as a runtime observation instead of rewriting
              // the user's capability configuration: following turns simply stop
              // sending images, and the file paths still reach the model as text.
              markImageInputRejected(
                active.harnessModelProfile.provider,
                active.harnessModelProfile.model,
                imageCapabilityFingerprint(this.host.imageCapabilityConfiguration(active)),
              );
              // Other live sessions on the same model must learn this too: their
              // Pi snapshot still advertises image input, so their own `read`
              // would send the payload this server just refused.
              void this.host.syncImageInputCapability();
              console.log(
                '[DBG mark]',
                JSON.stringify(this.host.imageCapabilityConfiguration(active)),
              );
              if (carriedImages) {
                active.imageRetryPending = true;
                active.imageRejectionHandled = true;
              }
            }
            return;
          }

          // A successful assistant message after failed attempts means the retry
          // recovered — drop the deferred error so it is never surfaced, and
          // clear the flag so agent_end still finalizes and completes the turn.
          // Errors the runtime recorded itself are sticky: Pi reports those
          // turns as a plain aborted or truncated turn, which must not erase them.
          if (!active.pendingError?.sticky) {
            active.errorSurfaced = false;
            active.pendingError = null;
            active.turnFailed = false;
          }

          const { text, thinking } = active.streamAccumulator.reconcile(event.message);
          const finalThinking = thinking || active.thinkingText;
          const finalAnswer = text || active.answerText;

          if (invalidatesPiFinalResponse(event.message)) {
            active.lastCompletedAnswerMessageId = null;
            active.lastCompletedAnswerText = '';
          }

          // Finalize thinking bubble (if any) on its own id.
          if (finalThinking.trim()) {
            if (finalThinking !== active.thinkingText) {
              active.thinkingLifecycle.markContentStreaming();
            }
            active.thinkingText = finalThinking;
            this.host.transcript.finalizeActiveThinking(sessionId, active);
          }
          // Finalize the answer bubble on its own id.
          if (finalAnswer.trim()) {
            this.recordFirstVisibleToken(sessionId, active);
            const startupLatency = active.startupLatency;
            active.startupLatency = undefined;
            active.answerText = finalAnswer;
            this.host.transcript.finalizeMessage(sessionId, active, 'answer', finalAnswer);
            if (isPiFinalResponse(event.message)) {
              active.lastCompletedAnswerMessageId = active.assistantMessageId;
              active.lastCompletedAnswerText = finalAnswer;
            }
            this.host.transcript.scheduleContextUsageSync(
              sessionId,
              active.assistantMessageId,
              event.message.usage,
              event.message.model,
              active.requestStartedAt,
              active.firstVisibleTextAt,
              startupLatency,
            );
          }

          // A turn can finish without any text (it answered with a tool call).
          // Its placeholder bubbles must still be closed: they were created with
          // isStreaming and would otherwise keep every later view of the session
          // spinning.
          this.host.transcript.closeIdlePlaceholders(sessionId, active);

          // Turn's segments are done; next turn starts fresh messages.
          active.assistantMessageId = null;
          active.thinkingMessageId = null;
          active.answerText = '';
          active.thinkingText = '';
          active.streamAccumulator.reset();
        }
        break;
      }

      case 'turn_end':
        break;

      case 'tool_execution_start': {
        active.lastCompletedAnswerMessageId = null;
        active.lastCompletedAnswerText = '';
        // Agent invoked a tool → emit a tool_use message so the UI renders the tool card.
        // Preserve the shared tool_use message shape.
        if (!event.toolCallId || !event.toolName) break;
        const runningActivity = active.toolActivityTracker.upsert(
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            toolInput: toToolActivityInput(event.args),
          },
          CoworkToolActivityPhase.Running,
        );
        active.toolStartedAtByCallId.set(event.toolCallId, Date.now());
        if (runningActivity) this.host.emit('toolActivity', sessionId, runningActivity);
        if (event.toolName === PiSubagentToolName) {
          active.researchRun?.recordSubagentStart(event.toolCallId, event.args);
          active.shortcutWorkflow?.recordSubagentStart(event.toolCallId, event.args);
        }
        const toolUseMsg: CoworkMessage = {
          id: randomUUID(),
          type: 'tool_use',
          content: `Using tool: ${event.toolName}`,
          timestamp: Date.now(),
          metadata: {
            toolName: event.toolName,
            toolInput: toToolInputRecord(event.args),
            toolUseId: event.toolCallId,
          },
        };
        // Emit the persisted message (store assigns its own id) to keep the
        // rendered id and DB id in sync — see message_end note.
        const store = this.host.getStore();
        const emittedToolUse = store ? store.addMessage(sessionId, toolUseMsg) : toolUseMsg;
        this.host.emit('message', sessionId, emittedToolUse);
        break;
      }

      case 'tool_execution_end': {
        // Tool finished → emit tool_result linked by toolUseId.
        if (!event.toolCallId) break;
        const removeActivity = active.toolActivityTracker.remove(event.toolCallId);
        if (removeActivity) this.host.emit('toolActivity', sessionId, removeActivity);
        // Avoid duplicate result for the same call.
        if (active.toolResultMessageIdByCallId.has(event.toolCallId)) break;
        const resultText = event.displayResultText ?? '';
        const resultIsError = Boolean(event.isError) || extractToolResultIsError(event.result);
        agentResourceDiagnostics.recordPiToolResult(sessionId, resultText.length * 2);
        if (active.workbenchRunId) {
          this.host
            .getWorkbench()
            ?.recordToolResult(
              active.workbenchRunId,
              event.toolCallId,
              event.result,
              resultIsError,
            );
        }
        if (event.toolName === PiSubagentToolName) {
          active.researchRun?.recordSubagentResult(event.toolCallId, resultText, resultIsError);
          active.shortcutWorkflow?.recordSubagentResult(
            event.toolCallId,
            resultText,
            resultIsError,
          );
        }
        // Keep the result only on `content` — duplicating into metadata.toolResult
        // doubles the largest strings in SQLite, IPC, and the renderer heap.
        const toolResultMsg: CoworkMessage = {
          id: randomUUID(),
          type: 'tool_result',
          content: resultText,
          timestamp: Date.now(),
          metadata: {
            toolUseId: event.toolCallId,
            isError: resultIsError,
            isStreaming: false,
            isFinal: true,
            ...(active.toolStartedAtByCallId.has(event.toolCallId)
              ? {
                  metrics: {
                    toolDurationMs: Math.max(
                      0,
                      Date.now() -
                        (active.toolStartedAtByCallId.get(event.toolCallId) ?? Date.now()),
                    ),
                  },
                }
              : {}),
          },
        };
        active.toolStartedAtByCallId.delete(event.toolCallId);
        const store = this.host.getStore();
        const emittedToolResult = store
          ? store.addMessage(sessionId, toolResultMsg)
          : toolResultMsg;
        active.toolResultMessageIdByCallId.set(event.toolCallId, emittedToolResult.id);
        this.host.emit('message', sessionId, emittedToolResult);
        break;
      }

      case 'tool_execution_update':
        // Streaming partial tool output — ignored for now (final result emitted on _end).
        // Kept as an explicit no-op so it doesn't fall to the "Unhandled" default log.
        break;

      case 'agent_end': {
        if (active.completionPending) break;
        this.host.transcript.finalizeActiveThinking(sessionId, active);
        active.toolStartedAtByCallId.clear();
        const clearActivity = active.toolActivityTracker.clear();
        if (clearActivity) this.host.emit('toolActivity', sessionId, clearActivity);
        // Failed attempt (deferred error pending): do not continue the agent
        // loop, mark completed, or emit complete. flushPendingError surfaces
        // the error when the run settles (auto_retry_end / agent_settled).
        // A non-retryable error is flushed the moment it is seen, so the turn
        // is already reported as failed by the time agent_end arrives.
        if (active.pendingError || active.errorSurfaced) break;
        const workbench = this.host.getWorkbench();
        if (active.workbenchRunId && workbench && !workbench.isRunRunning(active.workbenchRunId)) {
          this.host.stopActiveSession(
            sessionId,
            'The workbench run is no longer active.',
            false,
            CoworkInterruptionCause.RuntimePaused,
          );
          break;
        }
        // Agent loop: when the finished iteration signaled "next", continue
        // the session with the next iteration prompt instead of completing.
        const loopDecision = active.agentLoop.handleAgentEnd();
        if (loopDecision.shouldContinue && loopDecision.nextPrompt) {
          // Reset turn state (same as continueSession).
          active.answerText = '';
          active.thinkingText = '';
          active.assistantMessageId = null;
          active.thinkingMessageId = null;
          active.thinkingLifecycle.reset();
          active.lastCompletedAnswerMessageId = null;
          active.lastCompletedAnswerText = '';
          active.errorSurfaced = false;
          active.retryNoticeEmitted = false;
          active.retryAttempts = 0;
          active.toolResultMessageIdByCallId.clear();
          active.toolStartedAtByCallId.clear();
          active.piSession
            .prompt(loopDecision.nextPrompt, { streamingBehavior: 'followUp' })
            .catch(error => {
              const message = error instanceof Error ? error.message : String(error);
              this.host.emit('error', sessionId, classifyCoworkError(message));
            });
          break;
        }
        // agent_end is not the terminal signal: the SDK may follow it with an
        // automatic compaction continuation turn, whose tool calls still need
        // a live run. Completion happens on agent_settled.
        break;
      }

      case 'auto_retry_start':
        if (active.pendingError?.sticky) {
          void cancelPiRetry(active.piSession).catch(error => {
            console.error(`[PiRuntime] failed to cancel retry for session ${sessionId}:`, error);
          });
          break;
        }
        // Pi is retrying after an error. Retrying is invisible otherwise — the
        // failed attempt is deferred until the run settles — so the user is told
        // once per turn that the model answered with an error.
        active.retryAttempts += 1;
        if (!active.retryNoticeEmitted && active.pendingError) {
          active.retryNoticeEmitted = true;
          this.host.emit('retryNotice', sessionId, {
            sessionId,
            kind: active.pendingError.classified.kind,
            message: active.pendingError.classified.message,
            attempt: typeof event.attempt === 'number' ? event.attempt : active.retryAttempts,
          });
        }
        break;

      case 'auto_retry_end':
        // The runtime already ended and reported this turn: retry bookkeeping
        // must not reopen the error.
        if (active.errorSurfaced) break;
        // Pi reports both recovered retries and final exhaustion here.
        if (event.success === true && !active.pendingError?.sticky) {
          active.pendingError = null;
          active.turnFailed = false;
          break;
        }
        if (event.finalError && !active.pendingError?.sticky) {
          active.pendingError = {
            message: event.finalError,
            classified: classifyCoworkError(event.finalError),
          };
        }
        // Cancellation precedes agent_settled: retain the lane and writer lease.
        if (!active.pendingError?.sticky) this.host.flushPendingError(sessionId, active);
        break;

      case 'agent_settled':
        // Terminal signal: exactly once per prompt, after every continuation
        // the SDK runs on its own (compaction, queued follow-ups, retries).
        this.handleTurnSettled(sessionId, active);
        break;

      default:
        // Silently ignore unknown/internal events
        if (event.type && !event.type.startsWith('_')) {
          console.log('[PiRuntime] Unhandled event type:', event.type);
        }
    }
  }

  /**
   * Terminal signal for a prompt: agent_settled arrives exactly once, after
   * every continuation the SDK runs on its own (compaction, queued follow-ups,
   * retries). Completion must not happen earlier — an agent_end may still be
   * followed by a compaction continuation turn whose tool calls need a live
   * run.
   */
  private handleTurnSettled(sessionId: string, active: ActivePiSession): void {
    if (active.completionPending) return;
    active.isRunning = false;
    // Run settled with a deferred or surfaced failure: never complete it.
    // flushPendingError is idempotent after auto_retry_end.
    if (active.pendingError || active.errorSurfaced) {
      const retryingWithoutImages = this.host.flushPendingError(sessionId, active);
      if (!retryingWithoutImages) void this.host.flushFollowUpQueue(sessionId, active);
      return;
    }
    const settledWorkbench = this.host.getWorkbench();
    if (
      active.workbenchRunId &&
      settledWorkbench &&
      !settledWorkbench.isRunRunning(active.workbenchRunId)
    ) {
      this.host.stopActiveSession(
        sessionId,
        'The workbench run is no longer active.',
        false,
        CoworkInterruptionCause.RuntimePaused,
      );
      return;
    }
    this.host.transcript.markFinalAnswer(sessionId, active);
    this.host.transcript.clearThrottleStateBySession(sessionId, false);
    active.lastUsedAt = Date.now();
    agentResourceDiagnostics.finishPiTurn(
      sessionId,
      this.host.sessionCount(),
      this.host.activeSessions().filter(session => session.isRunning).length,
    );
    let verification: Promise<unknown> | undefined;
    const completingWorkbench = this.host.getWorkbench();
    if (active.workbenchRunId && completingWorkbench) {
      const domainWorkflowSnapshot = active.researchRun
        ? active.researchRun.getSnapshot()
        : active.shortcutWorkflow
          ? active.shortcutWorkflow.getSnapshot()
          : null;
      verification = completingWorkbench.completeRun({
        sessionId,
        runId: active.workbenchRunId,
        signal: active.abortController.signal,
        workspaceRoot: active.workspaceRoot,
        finalAnswer: active.lastCompletedAnswerText,
        finalMessageId: active.lastCompletedAnswerMessageId,
        workflowCompleted:
          active.researchRun || active.shortcutWorkflow
            ? active.agentLoop.getState().done
            : undefined,
        workflowSnapshot: domainWorkflowSnapshot,
      });
    }
    void settlePiWorkbenchCompletion(
      active,
      verification,
      () => this.host.getActiveSession(sessionId) === active && !active.aborted,
      () => {
        const store = this.host.getStore();
        if (store) {
          store.updateSession(sessionId, { status: 'idle' });
          if (!active.resourceState.chatMode) {
            try {
              store.refreshSessionArtifacts(sessionId);
            } catch (error) {
              console.error(
                `[PiRuntimeAdapter] artifact refresh failed for session ${sessionId}:`,
                error,
              );
            }
          }
        }
        if (!active.resourceState.chatMode) {
          void this.host.runPostTurnMemoryMaintenance(
            sessionId,
            active.workspaceRoot,
            this.host.createSessionMemoryCompletion(active),
          );
        }
        this.host.emit('complete', sessionId);
        void this.host.flushFollowUpQueue(sessionId, active);
      },
      error => {
        console.error(`[PiRuntimeAdapter] completion failed for session ${sessionId}:`, error);
        this.host.getWorkbench()?.failRun?.(sessionId, { message: String(error) });
        this.host.emit('error', sessionId, classifyCoworkError(String(error)));
      },
    );
  }
}

/** Normalize Pi tool args into a plain record for CoworkMessage metadata. */
function toToolInputRecord(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (args === undefined || args === null) return {};
  return { value: args };
}

function extractToolResultIsError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return false;
  return Boolean((details as { isError?: unknown }).isError);
}
