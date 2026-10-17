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
import { EventEmitter } from 'events';
import * as os from 'os';
import path from 'path';

import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { ZhiyuanModelPoolWorkload } from '../../../shared/modelPool/constants';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { persistCoworkImageAttachments } from '../../coworkImageAttachments';
import type { CoworkStore } from '../../coworkStore';
import type { ConversationHistoryService } from '../../conversationHistory/service';
import { MemoryInjectionDedup } from '../../memory/memoryInjectionDedup';
import type { ProjectMemoryService } from '../../memory/projectMemoryService';
import { SessionMemoryCompletionRole } from '../../memory/sessionMemoryExtractor';
import type { SessionMemoryCompletion } from '../../memory/sessionMemoryExtractor';
import type { SessionSummaryBackfillService } from '../../memory/sessionSummaryBackfillService';
import type { SessionSummaryService } from '../../memory/sessionSummaryService';
import { resolveBundledPresetMembers } from '../../presetExpertSnapshot';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import type {
  WorkbenchApprovalRequestedEvent,
  WorkbenchTaskService,
} from '../../workbenchTask/taskService';
import { getSkillsRoot } from '../coworkUtil';
import type { McpServerManager } from '../mcpServerManager';
import { resolveBundledOcrHelper } from '../ocrHelper';
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

export class PiRuntimeAdapter extends EventEmitter implements PiRuntime, PiRuntimeAdapterHost {
  readonly transcript = new PiAssistantTranscript({
    getStore: () => this.store,
    emitMessage: (sessionId, message) => {
      this.emit('message', sessionId, message);
    },
    emitMessageUpdate: (sessionId, messageId, content, metadata) => {
      this.emit('messageUpdate', sessionId, messageId, content, metadata);
    },
    getActiveSession: sessionId => this.activeSessions.get(sessionId),
  });

  readonly queue = new PiRuntimeQueueController(this);
  readonly sessionMemory = new PiRuntimeSessionMemory({
    getSessionSummaryService: () => this.sessionSummaryService,
    getSessionSummaryBackfillService: () => this.sessionSummaryBackfillService,
  });

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
    runPostTurnMemoryMaintenance: (sessionId, workingDirectory, complete) =>
      this.sessionMemory.runPostTurnMaintenance(sessionId, workingDirectory, complete),
  });

  readonly activeSessions = new Map<string, ActivePiSession>();
  /**
   * Sessions that have been stopped still need to look active to IM routing,
   * but must not keep the Pi session, transcript buffers, or tool maps.
   */
  readonly retainedSessionIds = new Set<string>();
  private imageAttachmentRoot: string | null = null;
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
  private store: CoworkStore | null = null;
  private mcpServerManager: McpServerManager | null = null;
  private bundledSkillsRoot: string | null = null;
  /**
   * Pi custom tools are fixed when a session is created. Bump this whenever
   * MCP discovery changes so the next user turn recreates an outdated session
   * with the current MCP proxy topology.
   */
  private mcpToolManifestGeneration = 0;
  private workbenchTaskService: WorkbenchTaskService | null = null;
  private projectMemoryService: ProjectMemoryService | null = null;
  private sessionSummaryService: SessionSummaryService | null = null;
  private sessionSummaryBackfillService: SessionSummaryBackfillService | null = null;
  private conversationHistoryService: ConversationHistoryService | null = null;
  private scheduledTaskService: ScheduledTaskService | null = null;
  readonly initializingSessions = new Map<string, InitializingPiSession>();
  readonly memoryInjectionDedup = new MemoryInjectionDedup();
  private workbenchApprovalListener: ((event: WorkbenchApprovalRequestedEvent) => void) | null =
    null;
  /** Bundled image-text helper; null when the platform/build cannot run it. */
  private readonly bundledOcrHelper = resolveBundledOcrHelper();

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

  setCoworkStore(store: CoworkStore): void {
    this.store = store;
  }

  setImageAttachmentRoot(root: string): void {
    this.imageAttachmentRoot = root;
  }

  persistImageAttachments(
    sessionId: string,
    attachments: PiStartOptions['imageAttachments'],
  ): PiStartOptions['imageAttachments'] {
    if (!attachments?.length || !this.imageAttachmentRoot) return attachments;
    // Already on disk — skip a second write when IPC (or enqueue) persisted first.
    if (attachments.every(item => Boolean(item.path) && !item.base64Data)) {
      return attachments;
    }
    return persistCoworkImageAttachments(this.imageAttachmentRoot, sessionId, attachments);
  }

  /**
   * Bundled SKILLs root (resources/SKILLs in production). Injected so the
   * live member source matches the main-session preset snapshot; getSkillsRoot
   * alone is wrong in packaged builds, where it resolves to the userData copy
   * that can drift from the bundled truth.
   */
  setBundledSkillsRoot(root: string): void {
    this.bundledSkillsRoot = root;
  }
  setProjectMemoryService(service: ProjectMemoryService): void {
    this.projectMemoryService = service;
  }
  setSessionSummaryService(service: SessionSummaryService): void {
    this.sessionSummaryService = service;
  }
  setSessionSummaryBackfillService(service: SessionSummaryBackfillService): void {
    this.sessionSummaryBackfillService = service;
  }
  setConversationHistoryService(service: ConversationHistoryService): void {
    this.conversationHistoryService = service;
  }
  setScheduledTaskService(service: ScheduledTaskService): void {
    this.scheduledTaskService = service;
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
  setMcpServerManager(mgr: McpServerManager): void {
    this.mcpServerManager = mgr;
    this.mcpInjected = true;
    this.mcpToolManifestGeneration += 1;
  }
  refreshMcpTools(): void {
    this.mcpToolManifestGeneration += 1;
  }
  hasMcpServerManager(): boolean {
    return this.mcpInjected;
  }
  private mcpInjected = false;

  // ── Host contract: late-bound services ──

  getStore(): CoworkStore | null {
    return this.store;
  }
  getWorkbenchTaskService(): WorkbenchTaskService | null {
    return this.workbenchTaskService;
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
  getMcpServerManager(): McpServerManager | null {
    return this.mcpServerManager;
  }
  getMcpToolManifestGeneration(): number {
    return this.mcpToolManifestGeneration;
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

  getPiAgentsDir(): string {
    const homedir = os.homedir();
    const configDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir, '.pi', 'agent');
    return path.join(configDir, 'agents');
  }

  /**
   * Live team member definitions for bundled presets. Returns null when the
   * preset is not bundled, so the subagent tool falls back to the synced pi
   * agents files (user-imported packages).
   */
  resolveBundledMemberProfiles(
    presetId: string,
  ): Array<{ id: string; description: string; systemPrompt: string }> | null {
    return resolveBundledPresetMembers(this.bundledSkillsRoot ?? getSkillsRoot(), presetId);
  }
}
