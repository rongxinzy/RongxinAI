/**
 * Pi Runtime Adapter
 *
 * Implements the Pi-native PiRuntime interface using the Pi SDK (in-process).
 * Pi is an embeddable agent loop library — no subprocess, no HTTP, just import.
 *
 * Architecture:
 *   startSession    → createAgentSession() → session.subscribe() → emit PiRuntimeEvents
 *   continueSession → session.prompt()
 *   stopSession     → session.abort()
 *
 * The adapter owns session state, late-bound services, and event emission.
 * Turn execution lives in sibling modules driven through the
 * PiRuntimeAdapterHost contract:
 *   piRuntimeSessionLaunch         — startSession (new Pi AgentSession + turn)
 *   piRuntimeSessionContinuation   — continueSession / patchSession
 *   piRuntimeSessionCustomTools    — per-session custom tool composition
 *   piRuntimeSessionLifecycle      — stop / dispose / evict / delete cleanup
 *   piRuntimeQueueController       — pending-message + control-action queue
 *   piRuntimeSessionMemory         — serialized memory completions
 *   piRuntimeResourceLoader        — DefaultResourceLoader + MCP gateway tool
 *   piRuntimeSettingsOverrides     — Pi settings/model budget overrides
 *   piRuntimeSkillDirs             — app-managed SKILLs directory resolution
 *   piRuntimeWorkbenchContract     — workbench contract derivation
 *
 * Packages:
 *   @earendil-works/pi-coding-agent — AgentSession, createAgentSession
 *   @earendil-works/pi-ai/compat    — getModel(), completeSimple()
 */

import { randomUUID } from 'crypto';
import { PiRuntimeServiceBindings } from './piRuntimeServiceBindings';

import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import { ZhiyuanModelPoolWorkload } from '../../../shared/modelPool/constants';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { MemoryInjectionDedup } from '../../memory/memoryInjectionDedup';
import { SessionMemoryCompletionRole } from '../../memory/sessionMemoryExtractor';
import type { SessionMemoryCompletion } from '../../memory/sessionMemoryExtractor';
import type {
  WorkbenchApprovalRequestedEvent,
  WorkbenchTaskService,
} from '../../workbenchTask/taskService';
import { PiAssistantTranscript } from './piAssistantTranscript';
import {
  buildPiBackgroundCompletionContext,
  extractPiBackgroundCompletionText,
} from './piBackgroundCompletion';
import type { PiAskUserQuestionResponse } from './piAskUserQuestion';
import type { PiCodingElicitationResponse } from './piCodingElicitation';
import { PiCadViewerService } from './piCadViewerTool';
import { resolvePiModel } from './piMagpiePiModel';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import { PiRuntimeQueueController } from './piRuntimeQueueController';
import { PiRuntimeSessionMemory } from './piRuntimeSessionMemory';
import { continuePiRuntimeSession, patchPiRuntimeSession } from './piRuntimeSessionContinuation';
import { startPiRuntimeSession } from './piRuntimeSessionLaunch';
import {
  disposePiSessionForRecreation,
  evictIdlePiRuntimeSessions,
  onPiSessionDeleted,
  stopActivePiRuntimeSession,
  stopAllPiRuntimeSessions,
} from './piRuntimeSessionLifecycle';
import { PiRuntimeTurnEvents } from './piRuntimeTurnEvents';
import { PiRuntimeTurnRecovery } from './piRuntimeTurnRecovery';
import { recordCheckpointFallback } from '../../memory/sessionCheckpointService';
import { HarnessActivationType } from '../../../shared/harness/constants';
import {
  getPiModules,
  type ActivePiSession,
  type InitializingPiSession,
} from './piRuntimeSessionState';
import type {
  PiContinueOptions,
  PiPermissionResult,
  PiRuntime,
  PiRuntimeEvents,
  PiSessionPatch,
  PiStartOptions,
} from './piRuntimeTypes';

// ── PiRuntimeAdapter ──

// Force ANSI color output from CLI tools (npm, git, jest, etc.) run by
// Pi's bash tool.  Pi executes commands via spawn + pipe, so TTY-aware
// tools won't emit escape sequences without this env var.
if (!process.env.FORCE_COLOR) process.env.FORCE_COLOR = '1';

export class PiRuntimeAdapter
  extends PiRuntimeServiceBindings
  implements PiRuntime, PiRuntimeAdapterHost
{
  readonly transcript = new PiAssistantTranscript({
    getStore: () => this.store,
    emitMessage: (sessionId, message) => {
      this.emit('message', sessionId, message);
    },
    emitMessageUpdate: (sessionId, messageId, content, metadata) => {
      this.emit('messageUpdate', sessionId, messageId, content, metadata);
    },
    emitMessageRemoved: (sessionId, messageId) => {
      this.emit('messageRemoved', sessionId, messageId);
    },
    getActiveSession: sessionId => this.activeSessions.get(sessionId),
    hasStreamingTextSubscribers: sessionId => this.hasStreamingTextSubscribers(sessionId),
  });

  /**
   * Resolvers declaring which sessions consume non-final full-text
   * `messageUpdate` events (IM mirrors, coding lanes). With no resolver
   * registered the adapter conservatively keeps emitting, which matches the
   * pre-gating behavior; final messageUpdate events are never gated.
   */
  private readonly streamingTextInterestResolvers: Array<(sessionId: string) => boolean> = [];

  registerStreamingTextInterestResolver(resolver: (sessionId: string) => boolean): () => void {
    this.streamingTextInterestResolvers.push(resolver);
    return () => {
      const index = this.streamingTextInterestResolvers.indexOf(resolver);
      if (index >= 0) this.streamingTextInterestResolvers.splice(index, 1);
    };
  }

  hasStreamingTextSubscribers(sessionId: string): boolean {
    if (this.streamingTextInterestResolvers.length === 0) return true;
    return this.streamingTextInterestResolvers.some(resolver => resolver(sessionId));
  }

  readonly queue = new PiRuntimeQueueController(this);
  readonly sessionMemory = new PiRuntimeSessionMemory({});

  readonly turnEvents = new PiRuntimeTurnEvents({
    getStore: () => this.store,
    getWorkbench: () => this.workbenchTaskService,
    transcript: this.transcript,
    sessionCount: () => this.activeSessions.size,
    activeSessions: () => [...this.activeSessions.values()],
    getActiveSession: sessionId => this.activeSessions.get(sessionId),
    emit: (event, ...args) => {
      this.emit(event as 'started', ...(args as [string]));
    },
    stopActiveSession: (sessionId, reason, drainQueuedFollowUp, cause) => {
      this.stopActiveSession(sessionId, reason, drainQueuedFollowUp, cause);
    },
    flushFollowUpQueue: (sessionId, active) => this.queue.flushFollowUpQueue(sessionId, active),
    flushPendingError: (sessionId, active) => this.recovery.flushPendingError(sessionId, active),
    imageCapabilityConfiguration: active => this.recovery.imageCapabilityConfiguration(active),
    syncImageInputCapability: sessionIds => this.recovery.syncImageInputCapability(sessionIds),
    createSessionMemoryCompletion: active => this.sessionMemory.createCompletion(active),
    recordSummaryOmission: (sessionId, active) => this.recordSummaryOmission(sessionId, active),
  });

  readonly activeSessions = new Map<string, ActivePiSession>();
  /**
   * Sessions that have been stopped still need to look active to IM routing,
   * but must not keep the Pi session, transcript buffers, or tool maps.
   */
  readonly retainedSessionIds = new Set<string>();

  readonly cadViewerService = new PiCadViewerService();
  readonly approvalSessionMap = new Map<string, string>();
  readonly pendingAskUserQuestions = new Map<
    string,
    {
      sessionId: string;
      resolve: (response: PiAskUserQuestionResponse) => void;
      timer: ReturnType<typeof setTimeout>;
      removeAbortListener?: () => void;
    }
  >();
  readonly pendingCodingElicitations = new Map<
    string,
    {
      sessionId: string;
      resolve: (response: PiCodingElicitationResponse) => void;
      removeAbortListener?: () => void;
    }
  >();

  private workbenchTaskService: WorkbenchTaskService | null = null;

  readonly initializingSessions = new Map<string, InitializingPiSession>();
  readonly memoryInjectionDedup = new MemoryInjectionDedup();
  private workbenchApprovalListener: ((event: WorkbenchApprovalRequestedEvent) => void) | null =
    null;

  readonly recovery = new PiRuntimeTurnRecovery({
    getStore: () => this.store,
    getWorkbench: () => this.workbenchTaskService,
    transcript: this.transcript,
    getActiveSession: sessionId => this.activeSessions.get(sessionId),
    activeSessionIds: () => this.activeSessions.keys(),
    deleteActiveSession: sessionId => {
      this.activeSessions.delete(sessionId);
    },
    emit: (event, ...args) => {
      this.emit(event as 'started', ...(args as [string]));
    },
    continueSession: (sessionId, prompt, options) =>
      this.continueSession(sessionId, prompt, options),
    ocrCommandFor: () => this.bundledOcrHelper?.commandFor,
    approvalSessionMap: this.approvalSessionMap,
    pendingAskUserQuestions: this.pendingAskUserQuestions,
    pendingCodingElicitations: this.pendingCodingElicitations,
  });

  constructor() {
    super();
  }

  setWorkbenchTaskService(service: WorkbenchTaskService): void {
    if (this.workbenchTaskService && this.workbenchApprovalListener) {
      this.workbenchTaskService.off('approvalRequested', this.workbenchApprovalListener);
    }
    this.workbenchTaskService = service;
    this.workbenchApprovalListener = ({ sessionId, approval }) => {
      this.approvalSessionMap.set(approval.id, sessionId);
      this.emit('permissionRequest', sessionId, {
        requestId: approval.id,
        toolName: approval.toolName,
        toolInput: approval.request,
        toolUseId: approval.toolCallId,
      });
    };
    service.on('approvalRequested', this.workbenchApprovalListener);
  }

  // ── Host contract: late-bound services ──

  getWorkbenchTaskService(): WorkbenchTaskService | null {
    return this.workbenchTaskService;
  }

  // ── PiRuntime.on/off ──

  override on<U extends keyof PiRuntimeEvents>(event: U, listener: PiRuntimeEvents[U]): this {
    return super.on(event, listener);
  }

  override off<U extends keyof PiRuntimeEvents>(event: U, listener: PiRuntimeEvents[U]): this {
    return super.off(event, listener);
  }

  // ── Session lifecycle ──

  async startSession(
    sessionId: string,
    prompt: string,
    options: PiStartOptions = {},
  ): Promise<void> {
    return startPiRuntimeSession(this, sessionId, prompt, options);
  }

  async continueSession(
    sessionId: string,
    prompt: string,
    options: PiContinueOptions = {},
  ): Promise<void> {
    return continuePiRuntimeSession(this, sessionId, prompt, options);
  }

  async recordSummaryOmission(sessionId: string, active: ActivePiSession): Promise<void> {
    const goal =
      this.store
        ?.getSession(sessionId, 1)
        ?.messages.filter(message => message.type === 'user')
        .at(-1)?.content ?? '';
    const artifacts = this.artifactLedgerService?.list(sessionId) ?? [];
    this.workbenchTaskService?.measurement?.recordActivation(active.workbenchRunId ?? null, {
      activation: HarnessActivationType.SummaryOmitted,
      mechanism: 'session_checkpoint',
      evidence: { artifactsProduced: artifacts.length },
    });
    if (!this.projectMemoryService) return;
    await recordCheckpointFallback(this.projectMemoryService, {
      sessionId,
      workingDirectory: active.workspaceRoot,
      runId: active.workbenchRunId ?? null,
      turnId: active.lastCompletedAnswerMessageId,
      goal,
      finalAnswer: active.lastCompletedAnswerText,
      verificationStatus: active.turnFailed ? 'failed' : 'unverified',
      artifactReferences: artifacts.map(artifact => artifact.filePath ?? artifact.title),
    });
    this.workbenchTaskService?.measurement?.recordActivation(active.workbenchRunId ?? null, {
      activation: HarnessActivationType.SummaryFallback,
      mechanism: 'deterministic_fallback',
    });
  }

  async patchSession(sessionId: string, patch: PiSessionPatch): Promise<void> {
    return patchPiRuntimeSession(this, sessionId, patch);
  }

  disposeSessionForRecreation(sessionId: string, active: ActivePiSession): void {
    disposePiSessionForRecreation(this, sessionId, active);
  }

  stopSession(sessionId: string): void {
    this.stopActiveSession(
      sessionId,
      'The user stopped this run.',
      true,
      CoworkInterruptionCause.UserStop,
    );
  }

  stopActiveSession(
    sessionId: string,
    reason: string,
    drainQueuedFollowUp: boolean,
    cause?: CoworkInterruptionCause,
  ): void {
    stopActivePiRuntimeSession(this, sessionId, reason, drainQueuedFollowUp, cause);
  }

  stopAllSessions(): void {
    stopAllPiRuntimeSessions(this);
  }

  evictIdleSessions(now = Date.now()): void {
    evictIdlePiRuntimeSessions(this, now);
  }

  /** Applies the current approval mode to sessions that are already running. */
  setApprovalModeForSession(sessionId: string, approvalMode: WorkbenchApprovalMode): void {
    const active = this.activeSessions.get(sessionId);
    if (active) active.approvalMode = approvalMode;
  }

  respondToPermission(requestId: string, result: PiPermissionResult): void {
    const pendingQuestion = this.pendingAskUserQuestions.get(requestId);
    if (pendingQuestion) {
      this.recovery.finishAskUserQuestion(requestId, {
        behavior: result.behavior,
        ...(result.behavior === 'allow'
          ? { updatedInput: result.updatedInput }
          : { message: result.message }),
      });
      return;
    }

    const sessionId = this.approvalSessionMap.get(requestId);
    if (!sessionId) return;
    this.approvalSessionMap.delete(requestId);

    if (this.workbenchTaskService?.repository.getApproval(requestId)) {
      const denied = result.behavior === 'deny';
      this.workbenchTaskService.respondToApproval({
        approvalId: requestId,
        approved: !denied,
        reason: denied ? result.message : undefined,
      });
      if (denied) {
        this.stopActiveSession(
          sessionId,
          result.message || 'The user denied this action.',
          false,
          CoworkInterruptionCause.ApprovalDenied,
        );
      }
      return;
    }

    // Pi has no built-in permission system.
    // For deny: abort the current turn so the model stops.
    if (result.behavior === 'deny') {
      const active = this.activeSessions.get(sessionId);
      if (active) {
        void active.piSession.abort();
      }
    }
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId) || this.retainedSessionIds.has(sessionId);
  }

  isSessionRunning(sessionId: string): boolean {
    const active = this.activeSessions.get(sessionId);
    return Boolean(active && active.isRunning && !active.aborted);
  }

  /**
   * Live (not yet finalized) streaming texts for a session, backing the
   * renderer-initiated resync IPC: after a sequence gap or a mid-stream
   * attach, the renderer asks for one full snapshot per open message and then
   * keeps consuming deltas on top of it. Read-only — never mutates state.
   */
  getLiveStreamTexts(
    sessionId: string,
  ): Array<{ messageId: string; content: string; metadata: Record<string, unknown> }> {
    const active = this.activeSessions.get(sessionId);
    if (!active) return [];
    const texts: Array<{ messageId: string; content: string; metadata: Record<string, unknown> }> =
      [];
    if (
      active.thinkingMessageId &&
      !active.thinkingLifecycle.isMessageFinalized &&
      active.thinkingText.length > 0
    ) {
      texts.push({
        messageId: active.thinkingMessageId,
        content: active.thinkingText,
        metadata: { isStreaming: true, isFinal: false, isThinking: true },
      });
    }
    if (active.assistantMessageId && active.answerText.length > 0) {
      texts.push({
        messageId: active.assistantMessageId,
        content: active.answerText,
        metadata: { isStreaming: true, isFinal: false },
      });
    }
    return texts;
  }

  hasRunningSessions(): boolean {
    return (
      this.initializingSessions.size > 0 ||
      [...this.activeSessions.values()].some(session => session.isRunning && !session.aborted)
    );
  }

  respondToCodingElicitation(requestId: string, answer: string): boolean {
    const normalized = answer.trim();
    if (!normalized) return false;
    const pending = this.pendingCodingElicitations.get(requestId);
    if (!pending) return false;
    this.recovery.finishCodingElicitation(requestId, { cancelled: false, answer: normalized });
    return true;
  }

  cancelCodingElicitation(requestId: string, reason: string): boolean {
    if (!this.pendingCodingElicitations.has(requestId)) return false;
    this.recovery.finishCodingElicitation(requestId, { cancelled: true, reason });
    return true;
  }

  /** Compacts an idle Pi session without turning the action into model input. */
  async compactSession(sessionId: string): Promise<{ cancelled: boolean }> {
    const active = this.activeSessions.get(sessionId);
    if (!active || active.aborted) throw new Error('The local coding session is not active.');
    if (active.isRunning) throw new Error('The local coding session is still running.');
    if (!active.piSession.compact) throw new Error('Context compaction is unavailable.');
    const result = await active.piSession.compact();
    return { cancelled: result.cancelled === true };
  }

  // ── Pending-message queue (see piRuntimeQueueController) ──

  enqueueControlAction(
    sessionId: string,
    action: () => Promise<void>,
  ): { success: boolean; error?: string } {
    return this.queue.enqueueControlAction(sessionId, action);
  }

  listPendingMessages(sessionId: string) {
    return this.queue.list(sessionId);
  }

  enqueuePendingMessage(
    sessionId: string,
    text: string,
    imageAttachments?: PiContinueOptions['imageAttachments'],
    fileAttachments?: PiContinueOptions['fileAttachments'],
    skillIds?: string[],
  ) {
    return this.queue.enqueuePendingMessage(
      sessionId,
      text,
      imageAttachments,
      fileAttachments,
      skillIds,
    );
  }

  updatePendingMessage(sessionId: string, itemId: string, text: string) {
    return this.queue.updatePendingMessage(sessionId, itemId, text);
  }

  deletePendingMessage(sessionId: string, itemId: string) {
    return this.queue.deletePendingMessage(sessionId, itemId);
  }

  steerPendingMessage(sessionId: string, itemId: string) {
    return this.queue.steerPendingMessage(sessionId, itemId);
  }

  followUpPendingMessage(sessionId: string, itemId: string) {
    return this.queue.followUpPendingMessage(sessionId, itemId);
  }

  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null {
    return this.activeSessions.get(sessionId)?.confirmationMode || null;
  }

  onSessionDeleted(sessionId: string): void {
    onPiSessionDeleted(this, sessionId);
  }

  getSessionMemoryCompletion(sessionId: string): SessionMemoryCompletion | null {
    const active = this.activeSessions.get(sessionId);
    return active ? this.sessionMemory.createCompletion(active) : null;
  }

  /**
   * Send a prompt directly to the LLM, bypassing the agent loop.
   * For Chat mode — fast response, no tool execution.
   */
  async chatDirect(prompt: string, modelId?: string): Promise<string> {
    const pi = await getPiModules();
    const resolvedModel = await resolvePiModel(pi, modelId, undefined, {
      conversationId: randomUUID(),
      workload: ZhiyuanModelPoolWorkload.Chat,
    });
    const context = buildPiBackgroundCompletionContext([
      { role: SessionMemoryCompletionRole.User, content: prompt },
    ]);
    const result = resolvedModel.modelRuntime?.completeSimple
      ? await resolvedModel.modelRuntime.completeSimple(resolvedModel.model, context)
      : await pi.completeSimple(resolvedModel.model, context, resolvedModel.requestOptions);
    return extractPiBackgroundCompletionText(result);
  }

  async resetImageInputCapabilities(): Promise<void> {
    await this.recovery.resetImageInputCapabilities();
  }

  // ── Skills & MCP integration ──
}
