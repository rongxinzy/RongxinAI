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
 * The adapter owns session state, startup dependencies, and event emission.
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
 *   piToolPermissionGate           — Pi-native tool permission checks
 *
 * Packages:
 *   @earendil-works/pi-coding-agent — AgentSession, createAgentSession
 *   @earendil-works/pi-ai/compat    — model provider factories
 */

import { addAbortListener, EventEmitter } from 'node:events';
import * as os from 'node:os';
import path from 'node:path';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import type { ScheduledTaskDelivery } from '../../../scheduledTask/types';
import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import type { CoworkPersistedArtifact } from '../../../shared/cowork/artifacts';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import type { ArtifactLedger } from '../../artifactLedger/artifactLedger';
import type { ConversationHistoryService } from '../../conversationHistory/service';
import { persistCoworkImageAttachments } from '../../coworkImageAttachments';
import type { CoworkStore } from '../../coworkStore';
import { MemoryInjectionDedup } from '../../memory/memoryInjectionDedup';
import type { ProjectMemoryService } from '../../memory/projectMemoryService';
import type { SessionMemoryCompletion } from '../../memory/sessionMemoryExtractor';
import { readPresetMembersAsync } from '../../workbenchTask/artifactWorkerPool';
import { observeWorkbench } from '../../workbenchTask/observe';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { getSkillsRoot } from '../coworkUtil';
import { resolveBundledOcrHelper } from '../ocrHelper';
import {
  PiToolPermissionGate,
  type PiToolAuthorizationInput,
  type PiToolAuthorizationResult,
} from './piToolPermissionGate';
import { PiAssistantTranscript } from './piAssistantTranscript';
import type { PiAskUserQuestionResponse } from './piAskUserQuestion';
import type { PiCodingElicitationResponse } from './piCodingElicitation';
import { PiCadViewerService } from './piCadViewerTool';
import type { PiMcpServerSource } from './piMcpExtensionBridge';
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
import { PiRuntimeTurnEvents, type PiSummaryOmission } from './piRuntimeTurnEvents';
import { PiRuntimeTurnRecovery } from './piRuntimeTurnRecovery';
import { recordCheckpointFallback } from '../../memory/sessionCheckpointService';
import { HarnessActivationType } from '../../../shared/harness/constants';
import { invalidatePiSessionDir } from './piSessionStore';
import type { MagpieModelService } from '../../magpie/modelService';
import type { ActivePiSession, InitializingPiSession } from './piRuntimeSessionState';
import {
  isPiCompanionChatSession,
  type PiContinueOptions,
  type PiPermissionResult,
  type PiRuntime,
  type PiRuntimeEvents,
  type PiSessionPatch,
  type PiStartOptions,
} from './piRuntimeTypes';

export interface PiRuntimeDependencies {
  modelService?: MagpieModelService;
  coworkStore?: CoworkStore;
  imageAttachmentRoot?: string;
  piSessionStoreRoot?: string;
  /** Bundled SKILLs root, so live preset members match their bundled snapshot. */
  bundledSkillsRoot?: string;
  projectMemoryService?: ProjectMemoryService;
  conversationHistoryService?: ConversationHistoryService;
  scheduledTaskService?: ScheduledTaskService;
  getScheduledTaskDeliveryForSession?: (sessionId: string) => ScheduledTaskDelivery | null;
  mcpServerSource?: PiMcpServerSource;
  artifactLedger?: ArtifactLedger;
  workbenchTaskService?: WorkbenchTaskService;
}

export class PiRuntimeAdapter extends EventEmitter implements PiRuntime, PiRuntimeAdapterHost {
  readonly modelService: MagpieModelService | undefined;
  private readonly store: CoworkStore | null;
  private readonly imageAttachmentRoot: string | null;
  private readonly piSessionStoreRoot: string | null;
  private readonly bundledSkillsRoot: string | null;
  private readonly projectMemoryService: ProjectMemoryService | null;
  private readonly conversationHistoryService: ConversationHistoryService | null;
  private readonly scheduledTaskService: ScheduledTaskService | null;
  private readonly mcpServerSource: PiMcpServerSource | null;
  private readonly artifactLedgerService: ArtifactLedger | null;
  private readonly workbenchTaskService: WorkbenchTaskService | null;
  private readonly bundledOcrHelper = resolveBundledOcrHelper();

  private mcpConfigGeneration = 0;
  private shuttingDown = false;
  private readonly nativeSessionStops = new Map<string, Promise<void>>();

  readonly transcript = new PiAssistantTranscript({
    getMessageStore: sessionId => this.getStore(sessionId)?.messages ?? null,
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
   * Resolvers declaring which coding lane sessions consume non-final full-text
   * `messageUpdate` events. Final messageUpdate events are never gated.
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
    if (isPiCompanionChatSession(sessionId)) return false;
    return this.streamingTextInterestResolvers.some(resolver => resolver(sessionId));
  }

  readonly getScheduledTaskDeliveryForSession: PiRuntimeDependencies['getScheduledTaskDeliveryForSession'];

  readonly queue = new PiRuntimeQueueController(this);
  readonly sessionMemory = new PiRuntimeSessionMemory();

  readonly turnEvents = new PiRuntimeTurnEvents({
    getModelService: () => this.modelService,
    getStore: sessionId => this.getStore(sessionId),
    getWorkbench: sessionId => this.getWorkbenchTaskService(sessionId),
    transcript: this.transcript,
    sessionCount: () => this.activeSessions.size,
    activeSessions: () => [...this.activeSessions.values()],
    getActiveSession: sessionId => this.activeSessions.get(sessionId),
    emit: (event, ...args) => {
      this.emit(event as 'started', ...(args as [string]));
    },
    flushControlActions: (sessionId, active) => this.queue.flushControlActions(sessionId, active),
    onPiUserMessageStart: (sessionId, active, message) =>
      this.queue.onNativeUserMessageStart(sessionId, active, message),
    flushPendingError: (sessionId, active) => this.recovery.flushPendingError(sessionId, active),
    createSessionMemoryCompletion: active => this.sessionMemory.createCompletion(active),
    recordSummaryOmission: (sessionId, turn, artifacts) =>
      this.recordSummaryOmission(sessionId, turn, artifacts),
  });

  readonly activeSessions = new Map<string, ActivePiSession>();
  /**
   * Sessions that have been stopped still need to look active to IM routing,
   * but must not keep the Pi session, transcript buffers, or tool maps.
   */
  readonly retainedSessionIds = new Set<string>();

  readonly cadViewerService = new PiCadViewerService();
  readonly pendingAskUserQuestions = new Map<
    string,
    {
      sessionId: string;
      requestedAt: number;
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

  readonly initializingSessions = new Map<string, InitializingPiSession>();
  readonly memoryInjectionDedup = new MemoryInjectionDedup();
  private readonly permissionGate = new PiToolPermissionGate(this);

  readonly recovery = new PiRuntimeTurnRecovery({
    getModelService: () => this.modelService,
    getStore: sessionId => this.getStore(sessionId),
    getWorkbench: sessionId => this.getWorkbenchTaskService(sessionId),
    transcript: this.transcript,
    emit: (event, ...args) => {
      this.emit(event as 'started', ...(args as [string]));
    },
    pendingAskUserQuestions: this.pendingAskUserQuestions,
    pendingCodingElicitations: this.pendingCodingElicitations,
  });

  constructor(deps: PiRuntimeDependencies = {}) {
    super();
    this.modelService = deps.modelService;
    this.store = deps.coworkStore ?? null;
    this.imageAttachmentRoot = deps.imageAttachmentRoot ?? null;
    this.piSessionStoreRoot = deps.piSessionStoreRoot ?? null;
    this.bundledSkillsRoot = deps.bundledSkillsRoot ?? null;
    this.projectMemoryService = deps.projectMemoryService ?? null;
    this.conversationHistoryService = deps.conversationHistoryService ?? null;
    this.scheduledTaskService = deps.scheduledTaskService ?? null;
    this.getScheduledTaskDeliveryForSession = deps.getScheduledTaskDeliveryForSession;
    this.mcpServerSource = deps.mcpServerSource ?? null;
    this.artifactLedgerService = deps.artifactLedger ?? null;
    this.workbenchTaskService = deps.workbenchTaskService ?? null;
  }

  async authorizeToolCall(input: PiToolAuthorizationInput): Promise<PiToolAuthorizationResult> {
    return await this.permissionGate.authorizeToolCall(input);
  }

  clearToolPermissionsBySession(sessionId: string): void {
    this.permissionGate.clearBySession(sessionId);
  }

  getStore(sessionId?: string): CoworkStore | null {
    return sessionId && isPiCompanionChatSession(sessionId) ? null : this.store;
  }

  getWorkbenchTaskService(sessionId?: string): WorkbenchTaskService | null {
    return sessionId && isPiCompanionChatSession(sessionId) ? null : this.workbenchTaskService;
  }

  getArtifactLedger(): ArtifactLedger | null {
    return this.artifactLedgerService;
  }

  getProjectMemoryService(): ProjectMemoryService | null {
    return this.projectMemoryService;
  }

  getConversationHistoryService(): ConversationHistoryService | null {
    return this.conversationHistoryService;
  }

  getScheduledTaskService(): ScheduledTaskService | null {
    return this.scheduledTaskService;
  }

  getMcpServerSource(): PiMcpServerSource | null {
    return this.mcpServerSource;
  }

  /** Pi reloads its MCP extension when the stored configuration changes. */
  markMcpConfigurationChanged(): void {
    this.mcpConfigGeneration += 1;
  }

  getMcpConfigGeneration(): number {
    return this.mcpConfigGeneration;
  }

  getPiSessionStoreRoot(): string | null {
    return this.piSessionStoreRoot;
  }

  getOcrCommandFor(): ((imagePath: string) => string) | undefined {
    return this.bundledOcrHelper?.commandFor;
  }

  isStoredSessionWorkMode(sessionId: string): boolean {
    return (
      this.store?.getSession(sessionId, 0, { includeArtifacts: false })?.mode !==
      CoworkSessionMode.Chat
    );
  }

  readPresetMembers(presetId: string, signal: AbortSignal) {
    const configDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
    return readPresetMembersAsync(
      {
        skillsRoot: path.resolve(this.bundledSkillsRoot ?? getSkillsRoot()),
        piAgentsDir: path.resolve(configDir, 'agents'),
        presetId,
      },
      signal,
    );
  }

  async persistImageAttachments(
    sessionId: string,
    attachments: PiStartOptions['imageAttachments'],
    signal: AbortSignal,
    isCurrent: () => boolean,
  ): Promise<PiStartOptions['imageAttachments']> {
    if (!attachments?.length || !this.imageAttachmentRoot) return attachments;
    // IPC or enqueue may have already saved these files.
    if (attachments.every(item => Boolean(item.path) && !item.base64Data)) {
      return attachments;
    }
    return persistCoworkImageAttachments(this.imageAttachmentRoot, sessionId, attachments, {
      signal,
      isCurrent,
    });
  }

  // ── PiRuntime.on/off ──

  override on<U extends keyof PiRuntimeEvents>(event: U, listener: PiRuntimeEvents[U]): this {
    return super.on(event, listener);
  }

  override off<U extends keyof PiRuntimeEvents>(event: U, listener: PiRuntimeEvents[U]): this {
    return super.off(event, listener);
  }

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    // Companion replies go through their receipt, outside Cowork and channel projections.
    if (typeof args[0] === 'string' && isPiCompanionChatSession(args[0])) return false;
    return super.emit(event, ...args);
  }

  // ── Session lifecycle ──

  async startSession(
    sessionId: string,
    prompt: string,
    options: PiStartOptions = {},
  ): Promise<void> {
    if (isPiCompanionChatSession(sessionId)) {
      throw new Error('Invalid Companion chat session.');
    }
    return this.launchSession(sessionId, prompt, options);
  }

  /** Creates or recreates the native session for a turn already admitted by the adapter. */
  async launchSession(sessionId: string, prompt: string, options: PiStartOptions): Promise<void> {
    if (this.shuttingDown) throw new Error('The application is shutting down.');
    return startPiRuntimeSession(this, sessionId, prompt, options);
  }

  async continueSession(
    sessionId: string,
    prompt: string,
    options: PiContinueOptions = {},
  ): Promise<void> {
    if (this.shuttingDown) throw new Error('The application is shutting down.');
    const companionChat = isPiCompanionChatSession(sessionId);
    if (companionChat !== (options.companionChat === true)) {
      throw new Error('Invalid Companion chat session.');
    }
    if (companionChat) {
      return continuePiRuntimeSession(this, sessionId, prompt, {
        systemPrompt: options.systemPrompt,
        modelOverride: options.modelOverride,
        imageAttachments: options.imageAttachments,
        onSettled: options.onSettled,
      });
    }
    return continuePiRuntimeSession(this, sessionId, prompt, options);
  }

  /** A new run may mutate the workspace or dispose the recorder of the settled run. */
  waitForPriorArtifactCapture(sessionId: string): Promise<void> | undefined {
    const prior = this.activeSessions.get(sessionId);
    const capture = prior?.artifactRecorder?.pendingFinalCapture;
    if (!prior || !capture) return;
    const { signal } = prior.abortController;
    return (async () => {
      const closed = new Error('The session closed before the next run could start.');
      const cancelled = Promise.withResolvers<never>();
      // A stopped session must not keep waiting for the recorder's I/O to return.
      using _listener = addAbortListener(signal, () => cancelled.reject(closed));
      await Promise.race([capture, cancelled.promise]);
      if (this.shuttingDown || signal.aborted || this.activeSessions.get(sessionId) !== prior) {
        throw closed;
      }
    })();
  }

  async recordSummaryOmission(
    sessionId: string,
    turn: PiSummaryOmission,
    artifacts: readonly CoworkPersistedArtifact[],
  ): Promise<void> {
    observeWorkbench(sessionId, () => {
      this.workbenchTaskService?.measurement?.recordActivation(turn.workbenchRunId ?? null, {
        activation: HarnessActivationType.SummaryOmitted,
        mechanism: 'session_checkpoint',
        evidence: { artifactsProduced: artifacts.length },
      });
    });
    if (!this.projectMemoryService) return;
    await recordCheckpointFallback(this.projectMemoryService, {
      sessionId,
      workingDirectory: turn.workspaceRoot,
      runId: turn.workbenchRunId ?? null,
      turnId: turn.lastCompletedAnswerMessageId,
      goal: turn.summaryCheckpointGoal ?? '',
      finalAnswer: turn.lastCompletedAnswerText,
      verificationStatus: turn.turnFailed ? 'failed' : 'unverified',
      artifactReferences: artifacts.map(artifact => artifact.filePath ?? artifact.title),
    });
    if (this.shuttingDown) return;
    observeWorkbench(sessionId, () => {
      this.workbenchTaskService?.measurement?.recordActivation(turn.workbenchRunId ?? null, {
        activation: HarnessActivationType.SummaryFallback,
        mechanism: 'deterministic_fallback',
      });
    });
  }

  async patchSession(sessionId: string, patch: PiSessionPatch): Promise<void> {
    if (isPiCompanionChatSession(sessionId)) return;
    return patchPiRuntimeSession(this, sessionId, patch);
  }

  disposeSessionForRecreation(sessionId: string, active: ActivePiSession): void {
    disposePiSessionForRecreation(this, sessionId, active);
  }

  stopSession(sessionId: string, options?: Pick<PiContinueOptions, 'companionChat'>): void {
    if (isPiCompanionChatSession(sessionId) !== (options?.companionChat === true)) return;
    this.stopActiveSession(
      sessionId,
      'The user stopped this run.',
      options?.companionChat ? undefined : CoworkInterruptionCause.UserStop,
    );
  }

  stopActiveSession(sessionId: string, reason: string, cause?: CoworkInterruptionCause): void {
    stopActivePiRuntimeSession(this, sessionId, reason, { cause });
  }

  stopNativeSession(sessionId: string, active: ActivePiSession): void {
    const { piSession } = active;
    piSession.abortBash();
    active.abortController.abort();
    active.unsubscribe();
    // Pi still owns its JSONL and tool cleanup until the native run ends.
    this.trackNativeSessionStop(
      sessionId,
      Promise.try(() => piSession.abort()).finally(() => piSession.dispose?.()),
    );
  }

  trackNativeSessionStop(sessionId: string, stop: Promise<void>): void {
    const stopped = stop.finally(() => this.nativeSessionStops.delete(sessionId));
    this.nativeSessionStops.set(sessionId, stopped);
    void stopped.catch(error => console.warn(`[PiRuntime] Failed to stop ${sessionId}:`, error));
  }

  waitForNativeSessionStop(sessionId: string): Promise<void> | undefined {
    return this.nativeSessionStops.get(sessionId);
  }

  stopAllSessions(): void {
    try {
      stopAllPiRuntimeSessions(this);
    } finally {
      void this.cadViewerService.stop().catch(error => {
        console.warn('[PiRuntime] Failed to stop the CAD viewer:', error);
      });
    }
  }

  shutdown(): { drained: Promise<void>; viewerStopped: Promise<void> } {
    this.shuttingDown = true;
    const finalCaptures = [...this.activeSessions.values()].flatMap(active => {
      const recorder = active.artifactRecorder;
      const capture = recorder?.pendingFinalCapture;
      if (active.isRunning || !recorder || !capture) return [];
      // The settled run still owns a SQLite write after its Pi session stops.
      active.artifactRecorder = null;
      return [capture.finally(() => recorder.dispose())];
    });
    const stopSessions = Promise.try(() => stopAllPiRuntimeSessions(this));
    return {
      drained: Promise.allSettled([
        stopSessions,
        ...this.nativeSessionStops.values(),
        ...finalCaptures,
      ]).then(results => {
        const errors = results.flatMap(result =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (errors.length) throw new AggregateError(errors, 'Failed to stop Pi sessions.');
      }),
      viewerStopped: Promise.try(() => this.cadViewerService.shutdown()),
    };
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

    this.permissionGate.resolvePermission(requestId, result);
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId) || this.retainedSessionIds.has(sessionId);
  }

  isSessionRunning(sessionId: string): boolean {
    const active = this.activeSessions.get(sessionId);
    return (
      this.initializingSessions.has(sessionId) ||
      Boolean(active && active.isRunning && !active.aborted)
    );
  }

  getRunningSessionIds(): string[] {
    const sessionIds = new Set(this.initializingSessions.keys());
    for (const sessionId of this.activeSessions.keys()) {
      if (this.isSessionRunning(sessionId)) sessionIds.add(sessionId);
    }
    return [...sessionIds];
  }

  isSessionReservedForDelivery(sessionId: string): boolean {
    return (
      this.isSessionRunning(sessionId) &&
      Boolean(
        this.activeSessions.get(sessionId)?.onSettled ||
        this.initializingSessions.get(sessionId)?.onSettled,
      )
    );
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
    if (!active || isPiCompanionChatSession(sessionId)) return [];
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
    if (!active || active.aborted || isPiCompanionChatSession(sessionId))
      throw new Error('The local coding session is not active.');
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

  steerInput(sessionId: string, text: string) {
    return this.queue.steerInput(sessionId, text);
  }

  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null {
    return this.activeSessions.get(sessionId)?.confirmationMode || null;
  }

  getPendingModalPermissionSessionId(): string | undefined {
    const isModal = (sessionId: string) => this.getSessionConfirmationMode(sessionId) === 'modal';
    const tool = this.permissionGate.firstPendingApproval(isModal);
    for (const question of this.pendingAskUserQuestions.values()) {
      if (!isModal(question.sessionId)) continue;
      return tool && tool.requestedAt <= question.requestedAt ? tool.sessionId : question.sessionId;
    }
    return tool?.sessionId;
  }

  async onSessionDeleted(sessionId: string, piHistoryKey?: string | null): Promise<void> {
    if (isPiCompanionChatSession(sessionId)) return;
    await onPiSessionDeleted(this, sessionId, piHistoryKey);
  }

  /** Drops a session's Pi JSONL so the next turn cannot restore stale history. */
  async invalidatePiSessionDir(sessionId: string, piHistoryKey?: string | null): Promise<void> {
    if (!this.piSessionStoreRoot || isPiCompanionChatSession(sessionId)) return;
    await invalidatePiSessionDir(this.piSessionStoreRoot, sessionId, piHistoryKey);
  }

  getSessionMemoryCompletion(sessionId: string): SessionMemoryCompletion | null {
    const active = this.activeSessions.get(sessionId);
    return active ? this.sessionMemory.createCompletion(active) : null;
  }
}
