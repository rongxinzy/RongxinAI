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
 * Packages:
 *   @earendil-works/pi-coding-agent — AgentSession, createAgentSession
 *   @earendil-works/pi-ai/compat    — getModel(), completeSimple()
 */

import { randomUUID } from 'crypto';
import { app } from 'electron';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import { classifyCoworkError } from '../../../common/coworkError';
import {
  CoworkSessionExpertSource,
  normalizeSingleExpertIds,
} from '../../../shared/cowork/sessionExperts';
import {
  CoworkQueueDelivery,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import {
  assertCoworkSubmissionContent,
  hasVisiblePromptContent,
} from '../../../shared/cowork/submissionContent';
import {
  CoworkInterruptionCause,
  type CoworkSessionInterruption,
} from '../../../shared/cowork/interruption';
import {
  HarnessVersion,
  type HarnessActivationEvent,
  type HarnessModelProfileInput,
} from '../../../shared/harness';
import { ZhiyuanModelPoolWorkload } from '../../../shared/modelPool/constants';
import {
  WorkbenchApprovalMode,
  WorkbenchContractKind,
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactVerificationStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
  type WorkbenchTaskContract,
} from '../../../shared/workbenchTask';
import {
  isLocalProviderName,
  ModelCapabilityStatus,
  type ProviderModelPiCompaction,
} from '../../../shared/providers';
import { persistCoworkImageAttachments } from '../../coworkImageAttachments';
import { buildPiLoadedMcpConfig, buildPiMcpTransportFactory } from './piMcpExtensionBridge';
import type { CoworkMessage } from '../../coworkStore';
import { agentResourceDiagnostics } from '../../agentResourceDiagnostics';
import type { CoworkStore } from '../../coworkStore';
import { resolveBundledPresetMembers } from '../../presetExpertSnapshot';
import { buildPiConversationHistoryTool } from '../../conversationHistory/piTool';
import type { ConversationHistoryService } from '../../conversationHistory/service';
import { t } from '../../i18n';
import { MemoryInjectionDedup } from '../../memory/memoryInjectionDedup';
import { buildPiProjectMemoryTool } from '../../memory/piMemoryTool';
import {
  finalizePiPromptWithProjectMemory,
  resolveProjectMemoryContextForPiPrompt,
} from '../../memory/piRuntimeProjectMemoryPrompt';
import type { ProjectMemoryService } from '../../memory/projectMemoryService';
import type {
  SessionMemoryCompletion,
  SessionMemoryCompletionMessage,
} from '../../memory/sessionMemoryExtractor';
import { SessionMemoryCompletionRole } from '../../memory/sessionMemoryExtractor';
import type { SessionSummaryService } from '../../memory/sessionSummaryService';
import type { SessionSummaryBackfillService } from '../../memory/sessionSummaryBackfillService';
import type {
  WorkbenchApprovalRequestedEvent,
  WorkbenchTaskService,
} from '../../workbenchTask/taskService';
import { applyApplicationRuntimeEnv, getSkillsRoot, resolveGitBashPathForPi } from '../coworkUtil';
import { getFeishuConnectorSkillsRoot } from '../feishuConnectorPaths';
import type { McpServerManager } from '../mcpServerManager';
import { isRasterPreviewDecodable, renderOfficePreview } from '../officePreviewRenderer';
import { createPiAskUserQuestionTool, type PiAskUserQuestionResponse } from './piAskUserQuestion';
import {
  createPiCodingElicitationTool,
  type PiCodingElicitationResponse,
} from './piCodingElicitation';
import { PiAgentLoopMode } from './piAgentLoop';
import { createPiPlanTool, isPlanModeBlockedTool, PiPlanModePrompt } from './piPlanTool';
import {
  buildPiBackgroundCompletionContext,
  extractPiBackgroundCompletionText,
} from './piBackgroundCompletion';
import {
  calculatePiConversationHistoryCharLimit,
  restorePiConversationPrompt,
  summarizePiHistoryFromStore,
} from './piConversationContext';
import { getPiBashCommandViolation, normalizePiBashTimeoutSeconds } from './piBashToolGuidelines';
import { PiBuiltinFileToolName } from './piWriteTokenLimit';
import { McpPiAdapter } from './mcpPiAdapter';
import { isAcademicResearchSkillSet, PiResearchRunController } from './piResearchRun';
import { buildPiResearchStateTool } from './piResearchStateTool';
import {
  PiShortcutWorkflowController,
  resolveShortcutWorkflowKind,
  ShortcutWorkflowKind,
} from './piShortcutWorkflow';
import { buildPiShortcutWorkflowStateTool } from './piShortcutWorkflowStateTool';
import {
  PiExtensionEventType,
  type PiExtensionApi,
  type PiExtensionFactory,
} from './piExtensionTypes';
import { buildPiSubagentTool } from './piSubagentTool';
import { buildPiSkillScriptTool } from './piSkillScriptTool';
import { resolvePiSkillRoots } from './piSkillRoots';
import { buildPiCadViewerTool, PiCadViewerService } from './piCadViewerTool';
import { buildPiSkillRuntimeCapabilitiesTool } from './piSkillRuntimeCapabilitiesTool';
import { buildPiDocumentReaderTool } from './piDocumentReaderTool';
import { getPythonRuntimeService } from '../../pythonRuntime/host';
import { buildPiPythonTools } from './piPythonTools';
import { buildPiScheduledTaskTool } from './piScheduledTaskTool';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import { buildDeclareArtifactTool } from '../../declareArtifact/tool';
import { PiThinkingLifecycle } from './piThinkingLifecycle';
import { PiStreamAccumulator } from './piStreamAccumulator';
import { PiEventProjectionQueue } from './piEventProjectionQueue';
import { applyPiEmbeddedHttpIdleTimeout } from './piHttpIdleTimeout';
import { PiPendingMessageQueue } from './piPendingMessageQueue';
import { shouldExposeAskUserQuestionTool } from './piUnattendedPolicy';
import { createPiWorkLoop } from './piWorkLoop';
import { resolvePiTurnWorkflowSkills } from './piTurnWorkflow';
import { PiWriteTokenLimitRecovery } from './piWriteTokenLimit';
import { collectPiSystemPromptContributions } from './piSystemPromptContributions';
import { createPiPromptOverrides } from './piPromptOverrides';
import { buildPiWebSearchTool } from './piWebSearchTool';
import { ToolActivityTracker } from './toolActivity';
import type {
  PiContinueOptions,
  PiPermissionResult,
  PiRuntime,
  PiRuntimeEvents,
  PiSessionPatch,
  PiStartOptions,
} from './piRuntimeTypes';
import { waitForPiRetryCancellation } from './piRetryCancellation';
import { resolveBundledOcrHelper } from '../ocrHelper';
import { collectImagePathReferences } from './piImageInputFallback';

import {
  ActivePiSession,
  getPiModules,
  haveSameStringList,
  InitializingPiSession,
  mergeSkillIds,
  normalizeSkillIds,
  PiChatRuntimeLimit,
  PiEvent,
  PiModelRuntime,
  PiModules,
  PiResourceLoader,
  PiResourceState,
  PiSettingsManager,
  preparePiPrompt,
  sendPiPrompt,
} from './piRuntimeSessionState';
import { DEFAULT_PI_LOCAL_MAX_TOKENS, resolvePiModel } from './piMagpiePiModel';
import { PiAssistantTranscript } from './piAssistantTranscript';
import { PiRuntimeTurnEvents } from './piRuntimeTurnEvents';
import { PiRuntimeTurnRecovery } from './piRuntimeTurnRecovery';
// ── PiRuntimeAdapter ──

// Force ANSI color output from CLI tools (npm, git, jest, etc.) run by
// Pi's bash tool.  Pi executes commands via spawn + pipe, so TTY-aware
// tools won't emit escape sequences without this env var.
if (!process.env.FORCE_COLOR) process.env.FORCE_COLOR = '1';

// Pi's bash tool inherits the main-process environment. Initialize the
// application-managed runtime once so later session creation cannot duplicate
// PATH entries in process.env.
let hasAppliedApplicationRuntimeEnv = false;

export class PiRuntimeAdapter extends EventEmitter implements PiRuntime {
  private readonly transcript = new PiAssistantTranscript({
    getStore: () => this.store,
    emitMessage: (sessionId, message) => {
      this.emit('message', sessionId, message);
    },
    emitMessageUpdate: (sessionId, messageId, content, metadata) => {
      this.emit('messageUpdate', sessionId, messageId, content, metadata);
    },
    getActiveSession: sessionId => this.activeSessions.get(sessionId),
  });

  private readonly turnEvents = new PiRuntimeTurnEvents({
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
    flushFollowUpQueue: (sessionId, active) => this.flushFollowUpQueue(sessionId, active),
    flushPendingError: (sessionId, active) => this.recovery.flushPendingError(sessionId, active),
    imageCapabilityConfiguration: active => this.recovery.imageCapabilityConfiguration(active),
    syncImageInputCapability: sessionIds => this.recovery.syncImageInputCapability(sessionIds),
    createSessionMemoryCompletion: active => this.createSessionMemoryCompletion(active),
    runPostTurnMemoryMaintenance: (sessionId, workingDirectory, complete) =>
      this.runPostTurnMemoryMaintenance(sessionId, workingDirectory, complete),
  });

  private static readonly MAX_RESIDENT_IDLE_SESSIONS = 4;
  private static readonly IDLE_SESSION_TTL_MS = 30 * 60 * 1000;
  private readonly activeSessions = new Map<string, ActivePiSession>();
  /**
   * Sessions that have been stopped still need to look active to IM routing,
   * but must not keep the Pi session, transcript buffers, or tool maps.
   */
  private readonly retainedSessionIds = new Set<string>();
  private imageAttachmentRoot: string | null = null;
  private readonly pendingMessageQueue = new PiPendingMessageQueue();
  private readonly cadViewerService = new PiCadViewerService();
  /** Opaque application actions that run after queued Work prompts settle. */
  private readonly queuedControlActions = new Map<string, Array<() => Promise<void>>>();
  private readonly approvalSessionMap = new Map<string, string>();
  private readonly pendingAskUserQuestions = new Map<
    string,
    {
      sessionId: string;
      resolve: (response: PiAskUserQuestionResponse) => void;
      timer: ReturnType<typeof setTimeout>;
      removeAbortListener?: () => void;
    }
  >();
  private readonly pendingCodingElicitations = new Map<
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
  private readonly initializingSessions = new Map<string, InitializingPiSession>();
  private readonly pendingMemoryCompletions = new Map<string, Promise<string>>();
  private readonly memoryInjectionDedup = new MemoryInjectionDedup();
  private workbenchApprovalListener: ((event: WorkbenchApprovalRequestedEvent) => void) | null =
    null;
  /** Bundled image-text helper; null when the platform/build cannot run it. */
  private readonly bundledOcrHelper = resolveBundledOcrHelper();

  private readonly recovery = new PiRuntimeTurnRecovery({
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

  private persistImageAttachments(
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
    assertCoworkSubmissionContent({ prompt, imageAttachments: options.imageAttachments });
    this.evictIdleSessions();
    const expertIds = normalizeSingleExpertIds(options.expertIds);

    if (this.activeSessions.has(sessionId) || this.initializingSessions.has(sessionId)) {
      this.stopActiveSession(sessionId, 'The session was replaced by a new run.', false);
    }

    const abortController = new AbortController();
    const initialization: InitializingPiSession = {
      abortController,
      generation: Symbol(sessionId),
    };
    this.initializingSessions.set(sessionId, initialization);
    const isCurrentInitialization = (): boolean =>
      this.initializingSessions.get(sessionId)?.generation === initialization.generation &&
      !abortController.signal.aborted;

    const pi = await getPiModules();
    if (!isCurrentInitialization()) return;

    // Emit user message to UI (unless the caller already did).
    // Must persist via store.addMessage() — the CoworkStore is the source of
    // truth for messages; emit alone delivers to the in-memory Redux state
    // but never writes to SQLite, causing the prompt to vanish on session switch.
    if (!options.skipInitialUserMessage) {
      const storedImages = this.persistImageAttachments(sessionId, options.imageAttachments);
      // The transcript shows what the user attached to this input, never the
      // session's execution set (which also carries the expert preset bundle).
      // A caller that passes nothing attaches nothing.
      const attachedSkillIds = options.attachedSkillIds;
      const userMsg: CoworkMessage = {
        id: randomUUID(),
        type: 'user',
        content: prompt,
        timestamp: Date.now(),
        metadata:
          attachedSkillIds?.length ||
          expertIds.length ||
          storedImages?.length ||
          options.fileAttachments?.length
            ? {
                ...(attachedSkillIds?.length ? { skillIds: attachedSkillIds } : {}),
                ...(expertIds.length
                  ? {
                      experts: (
                        this.store?.getSession(sessionId, 0, { includeArtifacts: false })
                          ?.experts ?? []
                      )
                        .filter(expert => expertIds.includes(expert.expertId))
                        .map(expert => ({
                          expertId: expert.expertId,
                          expertName: expert.expertName,
                          presetId: expert.packageId,
                        })),
                    }
                  : {}),
                ...(storedImages?.length ? { imageAttachments: storedImages } : {}),
                ...(options.fileAttachments?.length
                  ? { fileAttachments: options.fileAttachments }
                  : {}),
              }
            : undefined,
      };
      const persisted = this.store ? this.store.addMessage(sessionId, userMsg) : userMsg;
      this.emit('message', sessionId, persisted);
    }

    let workbenchRunId: string | null = null;
    let activeSession: ActivePiSession | null = null;

    try {
      const workspaceRoot = options.workspaceRoot || process.cwd();
      // Pi's built-in bash tool snapshots process.env when it executes. Give
      // that snapshot the same app-managed Node/npm, Python, uv, and Git Bash
      // PATH configuration used by direct Skill execution.
      if (!hasAppliedApplicationRuntimeEnv) {
        applyApplicationRuntimeEnv(process.env as Record<string, string | undefined>);
        hasAppliedApplicationRuntimeEnv = true;
      }
      const sessionOptions: Record<string, unknown> = { cwd: workspaceRoot };
      // Cowork owns the canonical transcript in SQLite. Pi's default session
      // manager persists its own transcript, which would be duplicated by the
      // SQLite history prompt used when a session is recreated.
      if (pi.SessionManager?.inMemory) {
        sessionOptions.sessionManager = pi.SessionManager.inMemory(workspaceRoot);
      }

      // System prompt — user config only. Skills are discovered and appended
      // by the resource loader (additionalSkillPaths), which renders them via
      // pi's formatSkillsForPrompt — no manual injection here to avoid
      // duplicating the skills section.
      const basePrompt = options.systemPrompt?.trim() || '';
      const chatMode = options.sessionMode === CoworkSessionMode.Chat;
      const resourceState: PiResourceState = {
        systemPrompt: basePrompt,
        skillIds: normalizeSkillIds(options.skillIds),
        maxOutputTokens: DEFAULT_PI_LOCAL_MAX_TOKENS,
        fileToolsEnabled: options.confirmationMode !== 'text',
        unattended: options.unattended === true,
        chatMode,
        expertSkillDirs: this.resolveExpertPresetSkillDirs(options.expertIds),
        skillRoots: {},
      };
      resourceState.skillRoots = resolvePiSkillRoots(
        resourceState.skillIds,
        this.resolveZhiyuanSkillDirs(),
        resourceState.expertSkillDirs,
      );

      const workflowSkillIds = resolvePiTurnWorkflowSkills({
        attachedSkillIds: options.attachedSkillIds,
        previousWorkflowSkillIds: options._workflowSkillIdsOverride,
        availableSkillIds: resourceState.skillIds,
      });
      const shortcutKindForContract = isAcademicResearchSkillSet(workflowSkillIds)
        ? null
        : resolveShortcutWorkflowKind(workflowSkillIds);
      const workbenchContract = this.createWorkbenchContract(options.sessionMode, workflowSkillIds);
      if (this.workbenchTaskService && !chatMode) {
        const workbench = this.workbenchTaskService.beginRun({
          sessionId,
          goal: prompt,
          contract: workbenchContract,
          trigger: options._workbenchRunId
            ? WorkbenchRunTrigger.Resume
            : WorkbenchRunTrigger.Message,
          preparedRunId: options._workbenchRunId,
        });
        workbenchRunId = workbench.run.id;
      }

      // Pi's createAgentSession does not accept a systemPrompt option. Its
      // default resource loader supplies the Pi Coding Assistant identity,
      // so override that loader per session to keep expert contexts isolated.
      // Resolve model early — needed by both MCP proxy and subagent tool
      const resolvedModel = await resolvePiModel(pi, options.modelOverride, undefined, {
        conversationId: sessionId,
        workload:
          options.sessionMode === CoworkSessionMode.Chat
            ? ZhiyuanModelPoolWorkload.Chat
            : ZhiyuanModelPoolWorkload.Work,
      });
      if (!isCurrentInitialization()) return;
      const modelId =
        typeof resolvedModel.model.id === 'string'
          ? resolvedModel.model.id
          : options.modelOverride || 'unknown';
      const reasoning = resolvedModel.model.reasoning;
      const harnessModelProfile: HarnessModelProfileInput = {
        provider: resolvedModel.providerName,
        model: modelId,
        reasoningProfile:
          typeof reasoning === 'string' ? reasoning : reasoning === true ? 'enabled' : 'default',
        workflowKind: workbenchContract.kind,
        harnessVersion: HarnessVersion,
      };
      if (workbenchRunId && this.workbenchTaskService) {
        this.workbenchTaskService.updateRunContext(workbenchRunId, {
          model: harnessModelProfile.model,
          provider: harnessModelProfile.provider,
          reasoningProfile: harnessModelProfile.reasoningProfile,
          workspaceRoot,
          skillIds: resourceState.skillIds ?? [],
        });
        this.workbenchTaskService.measurement?.recordModelProfile(
          workbenchRunId,
          harnessModelProfile,
        );
      }
      const recordActivation = (event: HarnessActivationEvent): void => {
        const currentRunId = this.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId;
        if (!currentRunId) return;
        this.workbenchTaskService?.measurement?.recordActivation(currentRunId, event);
      };
      if (
        options.sessionMode === CoworkSessionMode.Work &&
        isLocalProviderName(resolvedModel.providerName) &&
        resolvedModel.capabilities?.toolCalling !== ModelCapabilityStatus.Supported
      ) {
        throw new Error(
          resolvedModel.capabilities?.toolCalling === ModelCapabilityStatus.Unsupported
            ? t('coworkLocalModelToolCallingUnsupported')
            : t('coworkLocalModelToolCallingUnknown'),
        );
      }
      resourceState.maxOutputTokens = resolvedModel.maxOutputTokens;
      const sessionModel = this.resolvePiSessionModel(resolvedModel.model, resourceState.chatMode);
      if (resourceState.chatMode) {
        resourceState.maxOutputTokens = Math.min(
          resourceState.maxOutputTokens,
          PiChatRuntimeLimit.MaxOutputTokens,
        );
      }
      sessionOptions.model = sessionModel;
      if (options.thinkingLevel) {
        // Pi clamps the level to what the resolved model actually supports.
        sessionOptions.thinkingLevel = options.thinkingLevel;
      }
      if (resolvedModel.modelRuntime) {
        sessionOptions.modelRuntime = resolvedModel.modelRuntime;
      }

      console.debug(`[PiRuntime] loading isolated resources for session ${sessionId}`);
      const settingsManager = this.createPiSettingsManager(pi, workspaceRoot);
      const contextWindowTokens =
        typeof resolvedModel.model.contextWindow === 'number'
          ? resolvedModel.model.contextWindow
          : undefined;
      const codemodeEnabled =
        options.codemode === true && !resourceState.chatMode && options.confirmationMode !== 'text';
      const mcpNativeBridge =
        options.mcpNativeBridge === true &&
        !resourceState.chatMode &&
        Boolean(this.mcpServerManager);
      const resourceLoader = await this.createPiResourceLoader(pi, workspaceRoot, resourceState, {
        sessionId,
        getRunId: () => this.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId,
        settingsManager,
        getApprovalMode: () =>
          this.activeSessions.get(sessionId)?.approvalMode ??
          options.approvalMode ??
          WorkbenchApprovalMode.Ask,
        enableCodemode: codemodeEnabled,
        enableMcpNative: mcpNativeBridge,
      });
      this.applyPiCompactionOverrides(
        settingsManager,
        contextWindowTokens,
        resolvedModel.modelCompactionOverride,
      );
      if (codemodeEnabled && settingsManager) {
        // "+codemode" adds the sandbox tool on top of the default tool set;
        // tool_search stays dormant until a deferred MCP server needs it.
        settingsManager.applyOverrides({ defaultTools: ['+codemode'] });
      }
      if (!isCurrentInitialization()) return;
      sessionOptions.resourceLoader = resourceLoader;
      if (settingsManager) {
        sessionOptions.settingsManager = settingsManager;
      }

      // Build custom tools: MCP proxy + optional subagent for Team Leads.
      // Each call creates a distinct tool instance for this Pi session, so its
      // sequential execution mode cannot block another session.
      const customTools: Record<string, unknown>[] = [];
      if (resourceState.chatMode) customTools.push(buildPiWebSearchTool());

      if (options.planTool === true || options.planMode === true) {
        // The plan tool never touches the workspace: it publishes the structured
        // plan the coding lane renders. It stays registered for the session so a
        // plan turn can reuse a live transcript instead of rebuilding the session.
        customTools.push(createPiPlanTool(entries => this.emit('plan', sessionId, { entries })));
      }

      if (options.codingElicitation === true) {
        // Coding-only free-text pause point: the agent asks, the lane waits.
        customTools.push(
          createPiCodingElicitationTool((toolCallId, input, signal) =>
            this.recovery.requestCodingElicitation(sessionId, toolCallId, input, signal),
          ),
        );
      }

      if (shouldExposeAskUserQuestionTool(resourceState.unattended)) {
        customTools.push(
          createPiAskUserQuestionTool((toolCallId, input, signal) =>
            this.recovery.requestAskUserQuestion(sessionId, toolCallId, input, signal),
          ),
        );
      }
      if (!resourceState.chatMode && this.projectMemoryService) {
        customTools.push(
          buildPiProjectMemoryTool({
            service: this.projectMemoryService,
            sessionId,
            workingDirectory: workspaceRoot,
            getMessages: () => this.store?.getSession(sessionId, 32)?.messages ?? [],
            complete: async messages => {
              const complete = this.getSessionMemoryCompletion(sessionId);
              if (!complete)
                throw new Error('The session model is unavailable for memory extraction.');
              return await complete(messages);
            },
          }),
        );
      }
      if (!resourceState.chatMode && this.conversationHistoryService) {
        customTools.push(
          buildPiConversationHistoryTool({
            service: this.conversationHistoryService,
            workingDirectory: workspaceRoot,
          }),
        );
      }
      if (this.scheduledTaskService && options.sessionMode === CoworkSessionMode.Work) {
        customTools.push(
          buildPiScheduledTaskTool({
            service: this.scheduledTaskService,
            workspaceId:
              this.store?.getSession(sessionId, 0, { includeArtifacts: false })?.workspaceId ??
              null,
            sessionKey: sessionId,
          }),
        );
      }
      if (!resourceState.chatMode && resourceState.fileToolsEnabled) {
        customTools.push(buildPiDocumentReaderTool({ workspaceRoot }));
        customTools.push(
          ...buildPiPythonTools({
            service: getPythonRuntimeService(),
            workspace: workspaceRoot,
          }),
        );
        customTools.push(
          buildDeclareArtifactTool({
            onDeclare: this.workbenchTaskService
              ? async artifact => {
                  const runId =
                    this.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId;
                  if (!runId) throw new Error('No active workbench run is available.');
                  await this.workbenchTaskService?.registerArtifact({
                    sessionId,
                    runId,
                    workspaceRoot,
                    signal: abortController.signal,
                    candidate: {
                      path: artifact.filePath,
                      source: WorkbenchArtifactCandidateSource.Declaration,
                      verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
                      role: artifact.role,
                      ...(artifact.title ? { title: artifact.title } : {}),
                      ...(artifact.kind ? { kind: artifact.kind } : {}),
                    },
                  });
                }
              : undefined,
          }),
        );
      }

      // MCP tools: register a single proxy tool (pi-mcp-adapter pattern)
      if (!resourceState.chatMode) {
        // The native bridge owns MCP tools when enabled; the gateway tool
        // would expose the same servers a second time.
        const mcpProxyTool = mcpNativeBridge ? null : this.buildMcpProxyTool();
        if (mcpProxyTool) {
          customTools.push(mcpProxyTool);
        }
      }

      // Academic research is a controlled workflow, not a prompt-only label.
      // It owns durable state and completion gates for the lifetime of this
      // session (and reloads the same state directory after a session restart).
      const researchRun =
        options.sessionMode !== CoworkSessionMode.Chat &&
        isAcademicResearchSkillSet(workflowSkillIds)
          ? new PiResearchRunController({
              sessionId,
              workspaceRoot,
              task: prompt,
              onActivation: recordActivation,
            })
          : null;
      if (researchRun) {
        researchRun.resumeForPrompt(prompt);
        customTools.push(buildPiResearchStateTool(researchRun));
      }
      const shortcutKind = researchRun ? null : shortcutKindForContract;
      const shortcutWorkflow =
        shortcutKind && options.sessionMode !== CoworkSessionMode.Chat
          ? new PiShortcutWorkflowController({
              sessionId,
              workspaceRoot,
              task: prompt,
              kind: shortcutKind,
              validateRasterPreview: isRasterPreviewDecodable,
              renderOfficePreview,
              onActivation: recordActivation,
            })
          : null;
      if (shortcutWorkflow) {
        shortcutWorkflow.resumeForPrompt(prompt);
        customTools.push(buildPiShortcutWorkflowStateTool(shortcutWorkflow));
      }

      if (options.sessionMode === CoworkSessionMode.Work && resourceState.skillIds?.length) {
        customTools.push(buildPiSkillRuntimeCapabilitiesTool());
        customTools.push(
          buildPiSkillScriptTool({
            workspaceRoot,
            allowedSkillIds: resourceState.skillIds,
            skillRoots: resourceState.skillRoots,
          }),
        );
        const cadSkillRoot = resourceState.skillRoots['text-to-cad'];
        if (cadSkillRoot) {
          customTools.push(
            buildPiCadViewerTool({
              workspaceRoot,
              skillRoot: cadSkillRoot,
              service: this.cadViewerService,
            }),
          );
        }
      }

      // Subagent tool: registered for every cowork session. When the session
      // agent is a Team Lead from a package, its presetId additionally exposes
      // the team member agents alongside the built-in profiles.
      let subagentPresetId: string | undefined;
      if (!resourceState.chatMode && this.store) {
        const candidateAgentIds = expertIds.length
          ? expertIds
          : options.agentId
            ? [options.agentId]
            : [];
        const leadAgent = candidateAgentIds
          .map(agentId => this.store?.getAgent(agentId))
          .find(
            candidate =>
              candidate?.source === CoworkSessionExpertSource.Package && candidate.presetId,
          );
        subagentPresetId = leadAgent?.presetId;
      }
      const subagentTool = resourceState.chatMode
        ? null
        : buildPiSubagentTool({
            getPiAgentsDir: () => this.getPiAgentsDir(),
            presetId: subagentPresetId,
            loadBundledMembers: subagentPresetId
              ? presetId =>
                  this.resolveBundledMemberProfiles(presetId)?.map(member => ({
                    ...member,
                    source: 'member' as const,
                  })) ?? null
              : undefined,
            resolvedModel,
            workspaceRoot,
            webSearchSkillPath:
              researchRun ||
              (options.sessionMode !== CoworkSessionMode.Chat &&
                shortcutKind === ShortcutWorkflowKind.DeepResearch)
                ? path.join(getSkillsRoot(), 'web-search')
                : undefined,
            createPiResourceLoader: (
              cwd,
              systemPrompt,
              maxOutputTokens,
              skillIds,
              extensionFactories,
            ) =>
              this.createPiResourceLoader(
                pi,
                cwd,
                {
                  systemPrompt,
                  skillIds,
                  maxOutputTokens,
                  fileToolsEnabled: true,
                  unattended: resourceState.unattended,
                  chatMode: resourceState.chatMode,
                  expertSkillDirs: [],
                  skillRoots: resolvePiSkillRoots(skillIds, this.resolveZhiyuanSkillDirs(), []),
                },
                {
                  sessionId,
                  getRunId: () =>
                    this.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId,
                  getApprovalMode: () =>
                    this.activeSessions.get(sessionId)?.approvalMode ??
                    options.approvalMode ??
                    WorkbenchApprovalMode.Ask,
                },
                extensionFactories,
              ),
          });
      if (subagentTool) {
        customTools.push(subagentTool);
      }

      // Agent loop tool: lets the LLM drive multi-iteration long-horizon
      // loops; the controller continues the session on agent_end.
      const completionWorkflow = researchRun || shortcutWorkflow;
      const shouldRunGoalLoop =
        options.goalMode === true && options.sessionMode === CoworkSessionMode.Work;
      const workLoop = createPiWorkLoop({
        goal: completionWorkflow?.goal || prompt,
        completionWorkflow: completionWorkflow || undefined,
        onActivation: recordActivation,
        start: Boolean(completionWorkflow || shouldRunGoalLoop),
      });
      const agentLoop = workLoop.controller;
      const workLoopPrompt = shouldRunGoalLoop ? workLoop.initialPrompt : '';
      if (completionWorkflow || shouldRunGoalLoop) customTools.push(workLoop.tool);

      if (customTools.length > 0) {
        sessionOptions.customTools = customTools;
      }

      // Chat mode: disable all built-in tools for direct LLM access
      if (options.confirmationMode === 'text') {
        sessionOptions.noTools = 'all';
      }

      const piSessionCreateStartedAt = Date.now();
      console.debug(`[PiRuntime] creating agent session for ${sessionId}`);
      const result = await pi.createAgentSession(sessionOptions);
      const session = result.session;
      if (mcpNativeBridge && typeof session.bindExtensions === 'function') {
        // The MCP extension connects its servers on session start; without an
        // explicit bind, SDK sessions never emit it (verified against pi's SDK
        // docs and examples/sdk/14-codemode-mcp.ts).
        await session.bindExtensions({});
      }
      const piSessionCreatedAt = Date.now();
      if (!isCurrentInitialization()) {
        void session.abort();
        return;
      }

      const active: ActivePiSession = {
        sessionId,
        piSession: session,
        abortController,
        model: sessionModel,
        modelRuntime: resolvedModel.modelRuntime,
        modelRequestOptions: resolvedModel.requestOptions,
        modelCompactionOverride: resolvedModel.modelCompactionOverride,
        codemodeEnabled,
        mcpNativeBridge,
        imageEndpointKey: resolvedModel.endpointKey,
        capabilities: {
          toolCalling: ModelCapabilityStatus.Unknown,
          imageInput: ModelCapabilityStatus.Unknown,
          videoInput: ModelCapabilityStatus.Unknown,
          audioInput: ModelCapabilityStatus.Unknown,
          documentInput: ModelCapabilityStatus.Unknown,
          reasoning: ModelCapabilityStatus.Unknown,
          ...resolvedModel.capabilities,
        },
        harnessModelProfile,
        requestedSystemPrompt: basePrompt,
        requestedModelOverride: options.modelOverride,
        requestedSkillIds: resourceState.skillIds,
        requestedWorkflowSkillIds: workflowSkillIds,
        requestedExpertIds: expertIds,
        turnExperts: (
          this.store?.getSession(sessionId, 0, { includeArtifacts: false })?.experts ?? []
        )
          .filter(expert => expertIds.includes(expert.expertId))
          .map(expert => ({
            expertId: expert.expertId,
            expertName: expert.expertName,
            presetId: expert.packageId,
          })),
        resourceState,
        assistantMessageId: null,
        thinkingMessageId: null,
        answerText: '',
        thinkingText: '',
        streamAccumulator: new PiStreamAccumulator(),
        thinkingLifecycle: new PiThinkingLifecycle(),
        lastCompletedAnswerMessageId: null,
        lastCompletedAnswerText: '',
        requestStartedAt: null,
        firstVisibleTextAt: null,
        piSessionCreatedAt,
        agentStartedAt: null,
        startupLatencyRecorded: false,
        confirmationMode: options.confirmationMode || 'modal',
        unsubscribe: () => {},
        aborted: false,
        toolResultMessageIdByCallId: new Map(),
        toolStartedAtByCallId: new Map(),
        preparingToolCallIdByContentIndex: new Map(),
        toolActivityTracker: new ToolActivityTracker(),
        agentLoop,
        researchRun,
        shortcutWorkflow,
        goalMode: options.goalMode === true,
        planMode: options.planMode === true,
        writeTokenLimitRecovery: new PiWriteTokenLimitRecovery(resourceState.maxOutputTokens),
        pendingError: null,
        errorSurfaced: false,
        retryNoticeEmitted: false,
        retryAttempts: 0,
        workbenchRunId,
        workbenchContract,
        workspaceRoot,
        settingsManager,
        approvalMode: options.approvalMode ?? WorkbenchApprovalMode.Ask,
        unattended: resourceState.unattended,
        isRunning: true,
        lastUsedAt: Date.now(),
        turnFailed: false,
        lastImagePrompt: null,
        imageRetryPending: false,
        imageRejectionHandled: false,
        queueFlushInFlight: false,
        mcpToolManifestGeneration: this.mcpToolManifestGeneration,
      };
      activeSession = active;

      // Session ownership stays on main; display transforms preserve SDK event order.
      active.eventProjection = new PiEventProjectionQueue<PiEvent>(
        event => this.turnEvents.handlePiEvent(sessionId, active, event),
        abortController.signal,
        error =>
          console.error(`[PiRuntime] event projection failed in session ${sessionId}:`, error),
      );
      console.debug(
        `[PiRuntime] Pi session created for ${sessionId} in ${piSessionCreatedAt - piSessionCreateStartedAt}ms`,
      );

      // Subscribe to Pi events before sending the prompt
      active.unsubscribe = session.subscribe(event => {
        if (abortController.signal.aborted || this.activeSessions.get(sessionId) !== active) {
          return;
        }
        this.emit('executionEvent', sessionId, event);
        active.eventProjection?.push(event);
      });

      if (!isCurrentInitialization()) {
        active.unsubscribe();
        void session.abort();
        return;
      }
      this.activeSessions.set(sessionId, active);
      agentResourceDiagnostics.startPiTurn(
        sessionId,
        this.activeSessions.size,
        [...this.activeSessions.values()].filter(session => session.isRunning).length,
      );
      this.initializingSessions.delete(sessionId);
      // A live Pi session replaces the lightweight IM retention marker.
      this.retainedSessionIds.delete(sessionId);

      // Send the prompt (may include conversation history for restart restores)
      let initialPrompt = researchRun
        ? researchRun.buildInitialPrompt(options._piPromptOverride || prompt)
        : shortcutWorkflow
          ? shortcutWorkflow.buildInitialPrompt(options._piPromptOverride || prompt)
          : options._piPromptOverride || prompt;
      if (shouldRunGoalLoop) {
        initialPrompt = `${workLoopPrompt}\n\n${initialPrompt}`;
      }
      if (options.planMode === true) {
        initialPrompt = `${PiPlanModePrompt}\n\n${initialPrompt}`;
      }
      // A fresh Pi transcript never contains an earlier memory block, so the
      // per-session dedup fingerprint must restart with it.
      this.memoryInjectionDedup.reset(sessionId);
      const projectMemoryContext = await resolveProjectMemoryContextForPiPrompt({
        chatMode: resourceState.chatMode,
        memoryInjectionDedup: this.memoryInjectionDedup,
        projectMemoryService: this.projectMemoryService,
        workspaceRoot,
        sessionId,
        userPrompt: prompt,
      });
      if (this.activeSessions.get(sessionId) !== active || abortController.signal.aborted) return;
      initialPrompt = finalizePiPromptWithProjectMemory({
        chatMode: resourceState.chatMode,
        sessionId,
        userPrompt: prompt,
        prompt: initialPrompt,
        projectMemoryContext,
        workbenchTaskService: this.workbenchTaskService,
      });

      // The user may stop the session while the execution-mode question is
      // open. Do not revive an aborted Pi turn when that question resolves.
      if (abortController.signal.aborted) return;

      console.debug(`[PiRuntime] dispatching initial prompt for session ${sessionId}`);
      const initialImagePrompt = preparePiPrompt(
        initialPrompt,
        options.imageAttachments,
        this.recovery.imageInputVerdictForActive(active),
        this.bundledOcrHelper?.commandFor,
        collectImagePathReferences(options.fileAttachments),
      );
      // Recorded before the request leaves: the SDK can report the rejection
      // through events that arrive before the send promise settles.
      this.recovery.recordImagePrompt(sessionId, active, initialPrompt, initialImagePrompt);
      await sendPiPrompt(session, initialImagePrompt, undefined);
      await active.eventProjection?.drain();
      await active.completionPending;
    } catch (error) {
      // A stopped turn can immediately restart from the first queued follow-up.
      // Its eventual abort rejection must not delete that replacement session.
      if (activeSession && this.activeSessions.get(sessionId) === activeSession) {
        this.memoryInjectionDedup.reset(sessionId);
        this.activeSessions.delete(sessionId);
      }
      if (abortController.signal.aborted) {
        this.emit('sessionStopped', sessionId);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.workbenchTaskService?.failRun?.(sessionId, { message });
      this.emit('error', sessionId, classifyCoworkError(message));
      throw error;
    } finally {
      if (this.initializingSessions.get(sessionId)?.generation === initialization.generation) {
        this.initializingSessions.delete(sessionId);
      }
    }
  }

  async continueSession(
    sessionId: string,
    prompt: string,
    options: PiContinueOptions = {},
  ): Promise<void> {
    assertCoworkSubmissionContent({ prompt, imageAttachments: options.imageAttachments });
    this.evictIdleSessions();
    const explicitExpertIds = normalizeSingleExpertIds(options.expertIds);
    const nextUnattended = options.unattended === true;
    const active = this.activeSessions.get(sessionId);
    const retryCancellation = active && waitForPiRetryCancellation(active.piSession);
    if (retryCancellation) await retryCancellation;
    if (active?.completionPending) await active.completionPending;
    if (!active || active.aborted) {
      if (active?.aborted) {
        this.activeSessions.delete(sessionId);
      }
      console.log(
        `[PiRuntime] continueSession: session ${sessionId} not active or was aborted, restoring context via prompt`,
      );
      const historyLoadStartedAt = Date.now();
      // Read the transcript tail in pages and stop at the character budget
      // instead of materializing the full history; the injected prompt is
      // identical because the selection rule only ever walks newest-first.
      // Metadata still comes from a zero-message read for mode/experts/cwd.
      const storedSession = this.store?.getSession(sessionId, 0, { includeArtifacts: false });
      const chatMode =
        options.sessionMode === CoworkSessionMode.Chat ||
        storedSession?.mode === CoworkSessionMode.Chat;
      const piPrompt = restorePiConversationPrompt(this.store, sessionId, prompt, {
        maxChars: this.resolveConversationHistoryCharLimit(undefined, undefined, chatMode),
        ocrCommandFor: this.bundledOcrHelper?.commandFor,
      });
      agentResourceDiagnostics.recordPiHistoryRestored(sessionId, {
        source: 'continue',
        ...summarizePiHistoryFromStore(this.store, sessionId),
        promptChars: piPrompt.length,
        restoreMs: Date.now() - historyLoadStartedAt,
      });
      return this.startSession(sessionId, prompt, {
        ...options,
        sessionMode: chatMode ? CoworkSessionMode.Chat : CoworkSessionMode.Work,
        skipInitialUserMessage: options._skipUserMessage,
        systemPrompt: options.systemPrompt ?? storedSession?.systemPrompt,
        expertIds:
          options.expertIds === undefined
            ? storedSession?.experts.slice(0, 1).map(expert => expert.expertId)
            : explicitExpertIds,
        workspaceRoot: options.workspaceRoot ?? storedSession?.cwd,
        agentId: options.agentId ?? storedSession?.agentId,
        modelOverride: options.modelOverride ?? storedSession?.modelOverride,
        goalMode: options.goalMode ?? active?.goalMode,
        unattended: nextUnattended,
        _piPromptOverride: piPrompt,
        _workflowSkillIdsOverride: resolvePiTurnWorkflowSkills({
          attachedSkillIds: options.attachedSkillIds,
          previousWorkflowSkillIds: active?.requestedWorkflowSkillIds,
          availableSkillIds: options.skillIds,
        }),
      });
    }

    const requestedSystemPrompt = options.systemPrompt?.trim();
    const requestedSkillIds =
      options.skillIds === undefined
        ? active.requestedSkillIds
        : normalizeSkillIds(options.skillIds);
    const requestedExpertIds =
      options.expertIds === undefined ? active.requestedExpertIds : explicitExpertIds;
    const requestedWorkflowSkillIds = resolvePiTurnWorkflowSkills({
      attachedSkillIds: options.attachedSkillIds,
      previousWorkflowSkillIds: active.requestedWorkflowSkillIds,
      availableSkillIds: requestedSkillIds,
    });
    const workflowChanged = !haveSameStringList(
      requestedWorkflowSkillIds,
      active.requestedWorkflowSkillIds,
    );
    const requestedSessionMode =
      options.sessionMode ??
      (active.workbenchContract.kind === WorkbenchContractKind.Chat
        ? CoworkSessionMode.Chat
        : CoworkSessionMode.Work);
    const nextGoalMode = options.goalMode ?? active.goalMode;
    const nextCodemode = options.codemode ?? active.codemodeEnabled;
    const nextMcpNativeBridge = options.mcpNativeBridge ?? active.mcpNativeBridge;
    // Plan mode is per-turn: an ordinary follow-up clears it again.
    const nextPlanMode = options.planMode === true;
    const mcpToolTopologyChanged =
      !active.resourceState.chatMode &&
      active.mcpToolManifestGeneration !== this.mcpToolManifestGeneration;
    const unattendedTopologyChanged = nextUnattended !== active.unattended;
    if (
      (options.modelOverride !== undefined &&
        options.modelOverride !== active.requestedModelOverride) ||
      !haveSameStringList(requestedExpertIds, active.requestedExpertIds) ||
      nextGoalMode !== active.goalMode ||
      nextCodemode !== active.codemodeEnabled ||
      nextMcpNativeBridge !== active.mcpNativeBridge ||
      mcpToolTopologyChanged ||
      unattendedTopologyChanged ||
      workflowChanged
    ) {
      const historyLoadStartedAt = Date.now();
      // Paged tail read, not a full transcript: see the continue-rebuild note.
      if (mcpToolTopologyChanged) {
        console.log('[PiRuntime] recreating session after MCP tool manifest refresh');
      }
      const piPrompt = restorePiConversationPrompt(this.store, sessionId, prompt, {
        maxChars: this.resolveConversationHistoryCharLimit(
          typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
          typeof active.model.maxTokens === 'number' ? active.model.maxTokens : undefined,
          active.resourceState.chatMode,
        ),
        ocrCommandFor: this.bundledOcrHelper?.commandFor,
      });
      agentResourceDiagnostics.recordPiHistoryRestored(sessionId, {
        source: 'recreate',
        ...summarizePiHistoryFromStore(this.store, sessionId),
        promptChars: piPrompt.length,
        restoreMs: Date.now() - historyLoadStartedAt,
      });
      this.disposeSessionForRecreation(sessionId, active);
      return this.startSession(sessionId, prompt, {
        ...options,
        sessionMode: requestedSessionMode,
        systemPrompt: requestedSystemPrompt ?? active.requestedSystemPrompt,
        skillIds: requestedSkillIds,
        expertIds: requestedExpertIds,
        goalMode: nextGoalMode,
        codemode: nextCodemode,
        mcpNativeBridge: nextMcpNativeBridge,
        unattended: nextUnattended,
        _piPromptOverride: piPrompt,
        _workflowSkillIdsOverride: requestedWorkflowSkillIds,
      });
    }

    if (options.approvalMode !== undefined) {
      active.approvalMode = options.approvalMode;
    }
    active.isRunning = true;
    active.turnFailed = false;
    active.errorSurfaced = false;
    active.retryNoticeEmitted = false;
    active.retryAttempts = 0;

    const nextSystemPrompt = requestedSystemPrompt ?? active.requestedSystemPrompt;
    const promptChanged = nextSystemPrompt !== active.requestedSystemPrompt;
    const skillsChanged = !haveSameStringList(requestedSkillIds, active.requestedSkillIds);
    if (skillsChanged) {
      const historyLoadStartedAt = Date.now();
      // Paged tail read, not a full transcript: see the continue-rebuild note.
      const piPrompt = restorePiConversationPrompt(this.store, sessionId, prompt, {
        maxChars: this.resolveConversationHistoryCharLimit(
          typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
          typeof active.model.maxTokens === 'number' ? active.model.maxTokens : undefined,
          active.resourceState.chatMode,
        ),
        ocrCommandFor: this.bundledOcrHelper?.commandFor,
      });
      agentResourceDiagnostics.recordPiHistoryRestored(sessionId, {
        source: 'skills-change',
        ...summarizePiHistoryFromStore(this.store, sessionId),
        promptChars: piPrompt.length,
        restoreMs: Date.now() - historyLoadStartedAt,
      });
      this.disposeSessionForRecreation(sessionId, active);
      return this.startSession(sessionId, prompt, {
        ...options,
        sessionMode: requestedSessionMode,
        systemPrompt: nextSystemPrompt,
        skillIds: requestedSkillIds,
        expertIds: requestedExpertIds,
        goalMode: nextGoalMode,
        codemode: nextCodemode,
        mcpNativeBridge: nextMcpNativeBridge,
        unattended: nextUnattended,
        _piPromptOverride: piPrompt,
        _workflowSkillIdsOverride: requestedWorkflowSkillIds,
      });
    }

    active.goalMode = nextGoalMode;
    active.planMode = nextPlanMode;

    if (promptChanged) {
      const previousSystemPrompt = active.resourceState.systemPrompt;
      const previousSkillIds = active.resourceState.skillIds;
      active.resourceState.systemPrompt = nextSystemPrompt;
      active.resourceState.skillIds = requestedSkillIds;
      try {
        // Pi reloads the existing ResourceLoader without replacing transcript
        // state, model, MCP tools, or custom expert tools.
        await active.piSession.reload();
        // AgentSession.reload() reloads SettingsManager from disk, so restore
        // the per-process bundled PortableGit override after every reload.
        this.applyPiShellOverride(active.settingsManager);
        this.applyPiCompactionOverrides(
          active.settingsManager,
          typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
          active.modelCompactionOverride,
        );
        active.requestedSystemPrompt = nextSystemPrompt;
        active.requestedSkillIds = requestedSkillIds;
        console.debug('[PiRuntime] reloaded session resources after prompt change');
      } catch (error) {
        active.resourceState.systemPrompt = previousSystemPrompt;
        active.resourceState.skillIds = previousSkillIds;
        active.isRunning = false;
        const message = error instanceof Error ? error.message : String(error);
        this.emit('error', sessionId, classifyCoworkError(message));
        throw error;
      }
    }

    if (this.workbenchTaskService && !active.resourceState.chatMode) {
      const workbenchContract = this.createWorkbenchContract(
        requestedSessionMode,
        requestedSkillIds,
      );
      const workbench = this.workbenchTaskService.beginRun({
        sessionId,
        goal: prompt,
        contract: workbenchContract,
        trigger: options._workbenchRunId ? WorkbenchRunTrigger.Resume : WorkbenchRunTrigger.Message,
        preparedRunId: options._workbenchRunId,
      });
      active.workbenchRunId = workbench.run.id;
      active.workbenchContract = workbenchContract;
      active.harnessModelProfile = {
        ...active.harnessModelProfile,
        workflowKind: workbenchContract.kind,
      };
      this.workbenchTaskService.measurement?.recordModelProfile(
        workbench.run.id,
        active.harnessModelProfile,
      );
      this.workbenchTaskService.updateRunContext(workbench.run.id, {
        model: active.harnessModelProfile.model,
        provider: active.harnessModelProfile.provider,
        reasoningProfile: active.harnessModelProfile.reasoningProfile,
        workspaceRoot: active.workspaceRoot,
        skillIds: requestedSkillIds ?? [],
      });
    }

    // Reset turn state
    active.answerText = '';
    active.thinkingText = '';
    active.assistantMessageId = null;
    active.thinkingMessageId = null;
    active.thinkingLifecycle.reset();
    active.lastCompletedAnswerMessageId = null;
    active.lastCompletedAnswerText = '';
    active.toolResultMessageIdByCallId.clear();
    active.toolStartedAtByCallId.clear();
    active.preparingToolCallIdByContentIndex.clear();
    const clearActivity = active.toolActivityTracker.clear();
    if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);
    active.writeTokenLimitRecovery.reset();
    active.pendingError = null;
    active.turnFailed = false;
    active.errorSurfaced = false;
    active.retryNoticeEmitted = false;
    active.retryAttempts = 0;
    active.turnExperts = (
      this.store?.getSession(sessionId, 0, { includeArtifacts: false })?.experts ?? []
    )
      .filter(expert => active.requestedExpertIds.includes(expert.expertId))
      .map(expert => ({
        expertId: expert.expertId,
        expertName: expert.expertName,
        presetId: expert.packageId,
      }));

    // Emit user message (persisted to SQLite, same as startSession).
    if (!options._skipUserMessage) {
      const storedImages = this.persistImageAttachments(sessionId, options.imageAttachments);
      // Same rule as startSession: the chips on this user turn are the skills the
      // user attached to this input, not the turn's execution set.
      const attachedSkillIds = options.attachedSkillIds;
      const userMsg: CoworkMessage = {
        id: randomUUID(),
        type: 'user',
        content: prompt,
        timestamp: Date.now(),
        metadata:
          attachedSkillIds?.length ||
          options._queueDelivery ||
          storedImages?.length ||
          options.fileAttachments?.length ||
          active.turnExperts.length
            ? {
                ...(attachedSkillIds?.length ? { skillIds: attachedSkillIds } : {}),
                ...(options._queueDelivery ? { queueDelivery: options._queueDelivery } : {}),
                ...(storedImages?.length ? { imageAttachments: storedImages } : {}),
                ...(options.fileAttachments?.length
                  ? { fileAttachments: options.fileAttachments }
                  : {}),
                ...(active.turnExperts.length ? { experts: active.turnExperts } : {}),
              }
            : undefined,
      };
      const persisted = this.store ? this.store.addMessage(sessionId, userMsg) : userMsg;
      this.emit('message', sessionId, persisted);
    }

    let nextPrompt = prompt;
    if (nextPlanMode) {
      nextPrompt = `${PiPlanModePrompt}\n\n${nextPrompt}`;
    }
    const completionWorkflow = active.researchRun || active.shortcutWorkflow;
    if (options.goalMode !== undefined && !completionWorkflow) {
      active.goalMode = options.goalMode;
      if (!active.goalMode && active.agentLoop.getState().active) {
        active.agentLoop.stop();
      }
    }
    const shouldRunGoalLoop =
      active.goalMode && active.workbenchContract.kind !== WorkbenchContractKind.Chat;
    if ((completionWorkflow || shouldRunGoalLoop) && !active.agentLoop.getState().active) {
      completionWorkflow?.resumeForPrompt(prompt);
      const loopPrompt = active.agentLoop.start({
        mode: PiAgentLoopMode.Goal,
        goal: completionWorkflow?.goal || prompt,
        passes: 0,
        stages: [],
      });
      nextPrompt = active.researchRun
        ? active.researchRun.buildInitialPrompt(prompt)
        : active.shortcutWorkflow
          ? active.shortcutWorkflow.buildInitialPrompt(prompt)
          : prompt;
      if (!completionWorkflow) {
        nextPrompt = `${loopPrompt}\n\n${nextPrompt}`;
      }
    }
    try {
      const projectMemoryContext = await resolveProjectMemoryContextForPiPrompt({
        chatMode: active.resourceState.chatMode,
        memoryInjectionDedup: this.memoryInjectionDedup,
        projectMemoryService: this.projectMemoryService,
        workspaceRoot: active.workspaceRoot,
        sessionId,
        userPrompt: prompt,
      });
      nextPrompt = finalizePiPromptWithProjectMemory({
        chatMode: active.resourceState.chatMode,
        sessionId,
        userPrompt: prompt,
        prompt: nextPrompt,
        projectMemoryContext,
        workbenchTaskService: this.workbenchTaskService,
      });
      const continuedImagePrompt = preparePiPrompt(
        nextPrompt,
        options.imageAttachments,
        this.recovery.imageInputVerdictForActive(active),
        this.bundledOcrHelper?.commandFor,
        collectImagePathReferences(options.fileAttachments),
      );
      this.recovery.recordImagePrompt(sessionId, active, nextPrompt, continuedImagePrompt);
      await sendPiPrompt(active.piSession, continuedImagePrompt, options._streamingBehavior);
      await active.eventProjection?.drain();
      await active.completionPending;
    } catch (error) {
      active.isRunning = false;
      if (active.abortController.signal.aborted) {
        this.emit('sessionStopped', sessionId);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', sessionId, classifyCoworkError(message));
      throw error;
    }
  }

  async patchSession(sessionId: string, patch: PiSessionPatch): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) return;

    if (patch.thinkingLevel) {
      try {
        await active.piSession.setThinkingLevel?.(patch.thinkingLevel);
        console.log('[PiRuntime] Thinking level updated via patchSession:', patch.thinkingLevel);
      } catch (err) {
        console.warn('[PiRuntime] Failed to update thinking level via patchSession:', err);
      }
    }

    if (!patch.model) return;

    try {
      const pi = await getPiModules();
      const resolvedModel = await resolvePiModel(pi, patch.model, active.modelRuntime, {
        conversationId: sessionId,
        workload:
          active.workbenchContract.kind === WorkbenchContractKind.Chat
            ? ZhiyuanModelPoolWorkload.Chat
            : ZhiyuanModelPoolWorkload.Work,
      });
      const model = this.resolvePiSessionModel(resolvedModel.model, active.resourceState.chatMode);
      await active.piSession.setModel(model);
      active.model = model;
      active.imageEndpointKey = resolvedModel.endpointKey;
      active.requestedModelOverride = patch.model;
      active.modelRuntime = resolvedModel.modelRuntime;
      active.modelRequestOptions = resolvedModel.requestOptions;
      active.modelCompactionOverride = resolvedModel.modelCompactionOverride;
      active.capabilities = {
        ...active.capabilities,
        ...resolvedModel.capabilities,
      };
      const reasoning = resolvedModel.model.reasoning;
      active.harnessModelProfile = {
        provider: resolvedModel.providerName,
        model:
          typeof resolvedModel.model.id === 'string' ? resolvedModel.model.id : patch.model.trim(),
        reasoningProfile:
          typeof reasoning === 'string' ? reasoning : reasoning === true ? 'enabled' : 'default',
        workflowKind: active.workbenchContract.kind,
        harnessVersion: HarnessVersion,
      };
      const maxOutputTokens = active.resourceState.chatMode
        ? Math.min(resolvedModel.maxOutputTokens, PiChatRuntimeLimit.MaxOutputTokens)
        : resolvedModel.maxOutputTokens;
      active.writeTokenLimitRecovery = new PiWriteTokenLimitRecovery(maxOutputTokens);
      if (active.resourceState.maxOutputTokens !== maxOutputTokens) {
        active.resourceState.maxOutputTokens = maxOutputTokens;
        await active.piSession.reload();
        this.applyPiShellOverride(active.settingsManager);
        this.applyPiCompactionOverrides(
          active.settingsManager,
          typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
          active.modelCompactionOverride,
        );
      }
      console.log('[PiRuntime] Model updated via patchSession:', patch.model);
    } catch (err) {
      console.warn('[PiRuntime] Failed to update model via patchSession:', err);
    }
  }

  private disposeSessionForRecreation(sessionId: string, active: ActivePiSession): void {
    // A queued control action belongs to the turn that queued it; replaying it
    // after a resource-driven recreation would be an unexpected side effect.
    this.queuedControlActions.delete(sessionId);
    this.recovery.dismissAskUserQuestionsBySession(sessionId);
    this.recovery.dismissCodingElicitationsBySession(sessionId, 'The session was recreated.');
    active.agentLoop.stop();
    active.pendingError = null;
    active.toolStartedAtByCallId.clear();
    const clearActivity = active.toolActivityTracker.clear();
    if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);
    active.piSession.abortBash();
    active.abortController.abort();
    active.unsubscribe();
    void active.piSession.abort();
    this.workbenchTaskService?.pauseRun?.(
      sessionId,
      'The session resources changed before the approval was resolved.',
    );
    this.recovery.clearApprovalsBySession(sessionId);
    this.memoryInjectionDedup.reset(sessionId);
    this.activeSessions.delete(sessionId);
  }

  stopSession(sessionId: string): void {
    this.stopActiveSession(
      sessionId,
      'The user stopped this run.',
      true,
      CoworkInterruptionCause.UserStop,
    );
  }

  private stopActiveSession(
    sessionId: string,
    reason: string,
    drainQueuedFollowUp: boolean,
    cause?: CoworkInterruptionCause,
  ): void {
    // Control actions are not durable user input: an explicit stop must not
    // carry them into a later session that reuses the same id.
    this.queuedControlActions.delete(sessionId);
    this.recovery.dismissAskUserQuestionsBySession(sessionId);
    this.recovery.dismissCodingElicitationsBySession(sessionId, reason);
    const initializing = this.initializingSessions.get(sessionId);
    if (initializing) {
      initializing.abortController.abort();
      this.initializingSessions.delete(sessionId);
    }
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      this.closeInterruptedToolUses(sessionId);
      this.workbenchTaskService?.pauseRun?.(sessionId, reason);
      this.recovery.clearApprovalsBySession(sessionId);
      if (cause && !this.retainedSessionIds.has(sessionId)) {
        this.recordSessionInterruption(sessionId, cause);
      }
      return;
    }
    const wasRunning = active.isRunning;
    if (!wasRunning && active.aborted) return;

    this.transcript.finalizeActiveThinking(sessionId, active);
    // Close in-flight tools before the turn is marked paused. Otherwise resume
    // starts a new command while the previous one still looks "running".
    this.closeInterruptedToolUses(sessionId);

    // Mark the session as aborted so continueSession knows not to reuse the Pi
    // session object, which may be in an inconsistent state after abort.
    active.aborted = true;
    active.isRunning = false;
    active.turnFailed = false;
    active.agentLoop.stop();
    // Drop any deferred error without surfacing it — the user stopped the turn.
    active.pendingError = null;
    active.toolStartedAtByCallId.clear();
    const clearActivity = active.toolActivityTracker.clear();
    if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);

    // Drop the Pi session after the turn is aborted. IM routing still treats the
    // session as active via retainedSessionIds, and the next turn rebuilds from SQLite.
    active.piSession.abortBash();
    active.abortController.abort();
    active.unsubscribe();
    void active.piSession.abort();
    this.workbenchTaskService?.pauseRun?.(sessionId, reason);
    this.recovery.clearApprovalsBySession(sessionId);
    this.emit('sessionStopped', sessionId);
    if (cause) this.recordSessionInterruption(sessionId, cause);

    const shouldDrainFollowUp =
      wasRunning &&
      drainQueuedFollowUp &&
      active.workbenchContract.kind !== WorkbenchContractKind.Chat &&
      this.pendingMessageQueue.hasPendingFollowUp(sessionId);
    this.releaseStoppedSession(sessionId);
    // Stopping flushes the throttled store write, which may carry isStreaming; the
    // partial answer bubble must not stay in flight after the run is gone.
    this.transcript.closeIdlePlaceholders(sessionId, active);

    if (shouldDrainFollowUp) {
      const next = this.pendingMessageQueue.findNextPending(
        sessionId,
        CoworkQueueDelivery.FollowUp,
      );
      if (next) void this.followUpPendingMessage(sessionId, next.id);
    }
  }

  /** Persist a terminal result for tool calls still open when the user pauses. */
  private closeInterruptedToolUses(sessionId: string): void {
    const store = this.store;
    if (!store || typeof store.getSessionMessagesDesc !== 'function') return;

    // Scan through the page containing the latest user message. Keep that
    // whole boundary page so nearby orphan tool calls still receive terminal
    // results, as in the previous full scan. Persist results oldest-first.
    const tailNewestFirst: CoworkMessage[] = [];
    const pageSize = 200;
    let offset = 0;
    try {
      for (;;) {
        const page = store.getSessionMessagesDesc(sessionId, pageSize, offset);
        if (page.length === 0) break;
        offset += page.length;
        tailNewestFirst.push(...page);
        if (page.some(message => message.type === 'user') || page.length < pageSize) break;
      }
    } catch {
      return;
    }
    if (tailNewestFirst.length === 0) return;
    const messages = tailNewestFirst.reverse();

    const closed = new Set<string>();
    for (const message of messages) {
      if (message.type !== 'tool_result') continue;
      const toolUseId = message.metadata?.toolUseId;
      if (typeof toolUseId === 'string' && toolUseId) closed.add(toolUseId);
    }

    for (const message of messages) {
      if (message.type !== 'tool_use') continue;
      const toolUseId = message.metadata?.toolUseId;
      if (typeof toolUseId !== 'string' || !toolUseId || closed.has(toolUseId)) continue;
      const result: CoworkMessage = {
        id: randomUUID(),
        type: 'tool_result',
        content: 'The command was interrupted because the task was paused.',
        timestamp: Date.now(),
        metadata: {
          toolUseId,
          isError: true,
          error: 'interrupted',
          isStreaming: false,
          isFinal: true,
        },
      };
      const persisted = store.addMessage(sessionId, result);
      this.emit('message', sessionId, persisted);
      closed.add(toolUseId);
    }
  }

  private recordSessionInterruption(
    sessionId: string,
    cause: CoworkInterruptionCause,
  ): CoworkSessionInterruption {
    const task = this.workbenchTaskService?.getCurrent(sessionId)?.task ?? null;
    const resumableTask = task?.contract.kind === WorkbenchContractKind.Chat ? null : task;
    const interruption: CoworkSessionInterruption = {
      sessionId,
      interruptionId: randomUUID(),
      cause,
      taskId: resumableTask?.id ?? null,
      recoverable: resumableTask?.status === WorkbenchTaskStatus.Paused,
    };
    const seed: CoworkMessage = {
      id: randomUUID(),
      type: 'system',
      content: '',
      timestamp: Date.now(),
      metadata: { interruption },
    };
    const message = this.store ? this.store.addMessage(sessionId, seed) : seed;
    this.store?.updateSession(sessionId, { status: 'idle' });
    this.emit('message', sessionId, message);
    this.emit('sessionInterrupted', interruption);
    return interruption;
  }

  stopAllSessions(): void {
    const sessionIds = new Set([
      ...this.activeSessions.keys(),
      ...this.initializingSessions.keys(),
    ]);
    for (const sessionId of sessionIds) {
      this.stopActiveSession(sessionId, 'The application stopped the active session.', false);
    }
    void this.cadViewerService.stop();
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

  /**
   * Adds an application-owned action after already queued Work prompts. The
   * callback is never persisted and never reaches the model.
   */
  enqueueControlAction(
    sessionId: string,
    action: () => Promise<void>,
  ): { success: boolean; error?: string } {
    const active = this.activeSessions.get(sessionId);
    if (!active || active.aborted) {
      return { success: false, error: 'The local coding session is not active.' };
    }
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Control actions require a Work session.' };
    }
    const actions = this.queuedControlActions.get(sessionId) ?? [];
    actions.push(action);
    this.queuedControlActions.set(sessionId, actions);
    if (!active.isRunning) void this.flushFollowUpQueue(sessionId, active);
    return { success: true };
  }

  listPendingMessages(sessionId: string): CoworkPendingMessage[] {
    return this.pendingMessageQueue.list(sessionId);
  }

  enqueuePendingMessage(
    sessionId: string,
    text: string,
    imageAttachments?: PiContinueOptions['imageAttachments'],
    fileAttachments?: PiContinueOptions['fileAttachments'],
    skillIds?: string[],
  ): { success: boolean; item?: CoworkPendingMessage; error?: string } {
    const active = this.activeSessions.get(sessionId);
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!active || !this.isSessionRunning(sessionId)) {
      return { success: false, error: 'The Work session is not running.' };
    }
    const normalizedText = text.trim();
    if (!hasVisiblePromptContent(normalizedText))
      return { success: false, error: 'Message text is required.' };
    // IPC enqueue already persists; IM/internal callers still pass base64 here.
    const storedImages = this.persistImageAttachments(sessionId, imageAttachments);
    const item = this.pendingMessageQueue.enqueue(
      sessionId,
      normalizedText,
      CoworkQueueDelivery.FollowUp,
      storedImages,
      fileAttachments,
      skillIds,
    );
    this.emitQueueUpdated(sessionId);
    return { success: true, item };
  }

  updatePendingMessage(
    sessionId: string,
    itemId: string,
    text: string,
  ): { success: boolean; item?: CoworkPendingMessage; error?: string } {
    if (!this.isWorkSession(sessionId, this.activeSessions.get(sessionId))) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    const normalizedText = text.trim();
    if (!hasVisiblePromptContent(normalizedText))
      return { success: false, error: 'Message text is required.' };
    const item = this.pendingMessageQueue.update(sessionId, itemId, normalizedText);
    if (!item) return { success: false, error: 'Pending message was not found.' };
    this.emitQueueUpdated(sessionId);
    return { success: true, item };
  }

  deletePendingMessage(sessionId: string, itemId: string): { success: boolean; error?: string } {
    if (!this.isWorkSession(sessionId, this.activeSessions.get(sessionId))) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!this.pendingMessageQueue.remove(sessionId, itemId)) {
      return { success: false, error: 'Pending message was not found.' };
    }
    this.emitQueueUpdated(sessionId);
    return { success: true };
  }

  async steerPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }> {
    const active = this.activeSessions.get(sessionId);
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!active || !this.isSessionRunning(sessionId)) {
      return { success: false, error: 'The Work session is not running.' };
    }
    // A queued message is initially classified as FollowUp, but the user can
    // explicitly promote any pending item to an immediate Steer.
    const item = this.pendingMessageQueue.take(sessionId, itemId);
    if (!item) return { success: false, error: 'Pending message was not found.' };
    this.emitQueueUpdated(sessionId);
    // A steer lands in the running session, so its picks must be loaded before
    // the prompt is sent: Pi filters both <available_skills> and the
    // run_skill_script whitelist from the session's skill set, and a skill
    // attached to this queued input is additive exactly like a follow-up's.
    const previousSkillIds = active.resourceState.skillIds;
    const steeredSkillIds = mergeSkillIds(previousSkillIds, item.skillIds);
    if (!haveSameStringList(steeredSkillIds, previousSkillIds)) {
      active.resourceState.skillIds = steeredSkillIds;
      try {
        // Pi reloads the existing ResourceLoader without replacing transcript
        // state, model, MCP tools, or custom expert tools.
        await active.piSession.reload();
        // AgentSession.reload() reloads SettingsManager from disk, so restore
        // the per-process bundled PortableGit override after every reload.
        this.applyPiShellOverride(active.settingsManager);
        this.applyPiCompactionOverrides(
          active.settingsManager,
          typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
          active.modelCompactionOverride,
        );
        active.requestedSkillIds = steeredSkillIds;
      } catch (error) {
        active.resourceState.skillIds = previousSkillIds;
        throw error;
      }
    }
    try {
      const queuedImagePrompt = preparePiPrompt(
        item.text,
        item.imageAttachments,
        this.recovery.imageInputVerdictForActive(active),
        this.bundledOcrHelper?.commandFor,
        collectImagePathReferences(item.fileAttachments),
      );
      this.recovery.recordImagePrompt(sessionId, active, item.text, queuedImagePrompt);
      await sendPiPrompt(active.piSession, queuedImagePrompt, 'steer');
      this.persistQueuedUserMessage(sessionId, item, CoworkQueueDelivery.Steer);
      active.isRunning = true;
      this.pendingMessageQueue.finishDelivery(item.id);
      return { success: true, item };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const restored = this.pendingMessageQueue.restore(sessionId, { ...item, error: message });
      this.emitQueueUpdated(sessionId);
      return { success: false, item: restored, error: message };
    }
  }

  async followUpPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }> {
    const active = this.activeSessions.get(sessionId);
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!this.isSessionActive(sessionId)) {
      return { success: false, error: 'The Work session is not active.' };
    }
    if (this.isSessionRunning(sessionId)) {
      return { success: false, error: 'The Work session is still running.' };
    }
    const item = this.pendingMessageQueue.take(sessionId, itemId, CoworkQueueDelivery.FollowUp);
    if (!item) return { success: false, error: 'Pending message was not found.' };
    this.emitQueueUpdated(sessionId);
    try {
      // The queued turn keeps the session's skills and adds its own picks; only
      // the picks belong on the user message.
      const activeSession = this.activeSessions.get(sessionId);
      await this.continueSession(sessionId, item.text, {
        sessionMode: CoworkSessionMode.Work,
        _queueDelivery: CoworkQueueDelivery.FollowUp,
        _streamingBehavior: 'followUp',
        imageAttachments: item.imageAttachments,
        fileAttachments: item.fileAttachments,
        skillIds: mergeSkillIds(activeSession?.resourceState.skillIds, item.skillIds),
        attachedSkillIds: item.skillIds,
      });
      this.pendingMessageQueue.finishDelivery(item.id);
      return { success: true, item };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const restored = this.pendingMessageQueue.restore(sessionId, { ...item, error: message });
      this.emitQueueUpdated(sessionId);
      return { success: false, item: restored, error: message };
    }
  }

  private isWorkSession(sessionId: string, active: ActivePiSession | undefined): boolean {
    if (active) return active.workbenchContract.kind !== WorkbenchContractKind.Chat;
    return (
      this.store?.getSession(sessionId, 0, { includeArtifacts: false })?.mode !==
      CoworkSessionMode.Chat
    );
  }

  private persistQueuedUserMessage(
    sessionId: string,
    item: CoworkPendingMessage,
    delivery: CoworkQueueDelivery,
  ): CoworkMessage {
    const message: CoworkMessage = {
      id: randomUUID(),
      type: 'user',
      content: item.text,
      timestamp: Date.now(),
      metadata: {
        queueDelivery: delivery,
        ...(item.skillIds?.length ? { skillIds: item.skillIds } : {}),
        ...(item.imageAttachments?.length ? { imageAttachments: item.imageAttachments } : {}),
        ...(item.fileAttachments?.length ? { fileAttachments: item.fileAttachments } : {}),
      },
    };
    const persisted = this.store ? this.store.addMessage(sessionId, message) : message;
    this.emit('message', sessionId, persisted);
    return persisted;
  }

  private emitQueueUpdated(sessionId: string): void {
    this.emit('queueUpdated', sessionId, this.pendingMessageQueue.list(sessionId));
  }

  private async flushFollowUpQueue(sessionId: string, active: ActivePiSession): Promise<void> {
    if (active.queueFlushInFlight || active.aborted) return;
    if (active.pendingError || active.turnFailed) {
      // A failed turn never drains work, so a control action queued behind it
      // would otherwise run after an unrelated later turn. Drop it instead.
      if (this.queuedControlActions.delete(sessionId)) {
        console.warn('[PiRuntime] dropped queued control actions after the turn failed');
      }
      return;
    }
    if (active.workbenchContract.kind === WorkbenchContractKind.Chat) return;
    active.queueFlushInFlight = true;
    let retryAfterFailure = false;
    try {
      if (active.aborted || active.isRunning) return;
      const next = this.pendingMessageQueue.takeNext(sessionId, CoworkQueueDelivery.FollowUp);
      if (!next) {
        // Control actions wait behind queued user prompts, and a single flush
        // runs one of them at a time for the same reason.
        const action = this.queuedControlActions.get(sessionId)?.shift();
        if (!action) return;
        if (this.queuedControlActions.get(sessionId)?.length === 0) {
          this.queuedControlActions.delete(sessionId);
        }
        try {
          await action();
        } catch (error) {
          console.error('[PiRuntime] queued control action failed:', error);
        }
        return;
      }
      this.emitQueueUpdated(sessionId);
      try {
        await this.continueSession(sessionId, next.text, {
          sessionMode: CoworkSessionMode.Work,
          _queueDelivery: CoworkQueueDelivery.FollowUp,
          _streamingBehavior: 'followUp',
          imageAttachments: next.imageAttachments,
          fileAttachments: next.fileAttachments,
          skillIds: mergeSkillIds(active.resourceState.skillIds, next.skillIds),
          attachedSkillIds: next.skillIds,
        });
        this.pendingMessageQueue.finishDelivery(next.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pendingMessageQueue.restore(sessionId, { ...next, error: message });
        this.emitQueueUpdated(sessionId);
        console.error('[PiRuntime] queued follow-up failed:', error);
        retryAfterFailure = true;
      }
    } finally {
      active.queueFlushInFlight = false;
      const hasNextFollowUp =
        this.pendingMessageQueue.hasPendingFollowUp(sessionId) ||
        (this.queuedControlActions.get(sessionId)?.length ?? 0) > 0;
      if (
        (retryAfterFailure || hasNextFollowUp) &&
        this.activeSessions.get(sessionId) === active &&
        !active.aborted &&
        !active.isRunning
      ) {
        void this.flushFollowUpQueue(sessionId, active);
      }
    }
  }

  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null {
    return this.activeSessions.get(sessionId)?.confirmationMode || null;
  }

  onSessionDeleted(sessionId: string): void {
    this.stopActiveSession(sessionId, 'The session was deleted.', false);
    this.recovery.clearApprovalsBySession(sessionId);
    this.memoryInjectionDedup.reset(sessionId);
    this.activeSessions.delete(sessionId);
    this.retainedSessionIds.delete(sessionId);
    this.transcript.clearThrottleStateBySession(sessionId, true);
    if (this.pendingMessageQueue.clear(sessionId)) this.emitQueueUpdated(sessionId);
    this.workbenchTaskService?.deleteSession(sessionId);
  }

  private evictIdleSessions(now = Date.now()): void {
    const idle = [...this.activeSessions.values()]
      .filter(session => {
        if (session.isRunning || session.completionPending) return false;
        if (this.pendingMessageQueue.hasPendingFollowUp(session.sessionId)) return false;
        if ((this.queuedControlActions.get(session.sessionId)?.length ?? 0) > 0) return false;
        return now - session.lastUsedAt >= PiRuntimeAdapter.IDLE_SESSION_TTL_MS;
      })
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    const residentIdle = [...this.activeSessions.values()].filter(
      session =>
        !session.isRunning &&
        !session.completionPending &&
        !this.pendingMessageQueue.hasPendingFollowUp(session.sessionId),
    ).length;
    const excessCount = Math.max(0, residentIdle - PiRuntimeAdapter.MAX_RESIDENT_IDLE_SESSIONS);
    const expired = idle.filter(
      session => now - session.lastUsedAt >= PiRuntimeAdapter.IDLE_SESSION_TTL_MS,
    );
    const nonExpired = idle.filter(
      session => now - session.lastUsedAt < PiRuntimeAdapter.IDLE_SESSION_TTL_MS,
    );
    const candidates = [
      ...expired,
      ...nonExpired.slice(0, Math.max(0, excessCount - expired.length)),
    ];
    for (const session of candidates) {
      session.unsubscribe();
      session.piSession.abortBash();
      void session.piSession.abort();
      this.memoryInjectionDedup.reset(session.sessionId);
      this.activeSessions.delete(session.sessionId);
      this.retainedSessionIds.add(session.sessionId);
      this.transcript.clearThrottleStateBySession(session.sessionId, true);
      console.debug(`[PiRuntime] evicted idle session ${session.sessionId} from memory`);
    }
  }

  private releaseStoppedSession(sessionId: string): void {
    this.memoryInjectionDedup.reset(sessionId);
    this.activeSessions.delete(sessionId);
    this.retainedSessionIds.add(sessionId);
    this.transcript.clearThrottleStateBySession(sessionId, true);
  }

  // ── Pi session resources and context limits ──

  private createPiSettingsManager(pi: PiModules, cwd: string): PiSettingsManager | null {
    if (!pi.SettingsManager) return null;
    // Cowork owns its runtime configuration. Loading Pi's user/project settings here can
    // trigger package installation or third-party extensions that differ between machines.
    const settingsManager =
      pi.SettingsManager.inMemory?.() ?? pi.SettingsManager.create(cwd, pi.getAgentDir());
    applyPiEmbeddedHttpIdleTimeout(settingsManager);
    return settingsManager;
  }

  private applyPiCompactionOverrides(
    settingsManager: PiSettingsManager | null,
    contextWindowTokens?: number,
    perModel?: { key: string; compaction: ProviderModelPiCompaction },
  ): void {
    if (!settingsManager) return;
    const contextWindow =
      Number.isFinite(contextWindowTokens) && (contextWindowTokens ?? 0) > 0
        ? Math.floor(contextWindowTokens!)
        : 32_768;
    // Keep compaction's summary request and retained conversation inside the
    // active model window. Pi's defaults (16K reserve, 20K recent) are tuned
    // for large hosted models and can exceed a local 16K/32K model's budget.
    const reserveTokens = Math.max(2_048, Math.min(16_384, Math.floor(contextWindow * 0.25)));
    const keepRecentTokens = Math.max(2_048, Math.min(20_000, Math.floor(contextWindow * 0.5)));
    settingsManager.applyOverrides({
      compaction: {
        enabled: true,
        reserveTokens,
        keepRecentTokens,
        // Per-model budgets ride pi's modelOverrides keyed by provider/modelId;
        // unconfigured fields fall back to the flat session budgets above. The
        // key is omitted entirely when unconfigured so the override payload
        // stays byte-identical to the pre-modelOverrides shape.
        ...(perModel
          ? {
              modelOverrides: {
                [perModel.key]: {
                  ...(perModel.compaction.reserveTokens !== undefined
                    ? { reserveTokens: perModel.compaction.reserveTokens }
                    : {}),
                  ...(perModel.compaction.keepRecentTokens !== undefined
                    ? { keepRecentTokens: perModel.compaction.keepRecentTokens }
                    : {}),
                },
              },
            }
          : {}),
      },
    });
  }

  private resolvePiSessionModel(
    model: Record<string, unknown>,
    chatMode: boolean,
  ): Record<string, unknown> {
    if (!chatMode) return model;
    return {
      ...model,
      ...(typeof model.maxTokens === 'number'
        ? { maxTokens: Math.min(model.maxTokens, PiChatRuntimeLimit.MaxOutputTokens) }
        : {}),
    };
  }

  private resolveConversationHistoryCharLimit(
    contextWindowTokens: number | undefined,
    maxOutputTokens: number | undefined,
    chatMode: boolean,
  ): number {
    const calculated = calculatePiConversationHistoryCharLimit(
      contextWindowTokens,
      maxOutputTokens,
    );
    return chatMode ? Math.min(calculated, PiChatRuntimeLimit.HistoryChars) : calculated;
  }

  private applyPiShellOverride(settingsManager: PiSettingsManager | null): void {
    if (!settingsManager || process.platform !== 'win32') return;
    const bashPath = resolveGitBashPathForPi();
    if (bashPath) {
      settingsManager.applyOverrides({ shellPath: bashPath });
    }
  }

  private async createPiResourceLoader(
    pi: PiModules,
    cwd: string,
    resourceState: PiResourceState,
    approvalContext?: {
      sessionId: string;
      getRunId: () => string | null;
      settingsManager?: PiSettingsManager | null;
      getApprovalMode: () => WorkbenchApprovalMode;
      /** Register the pi 1.0 codemode + tool_search extensions (work sessions). */
      enableCodemode?: boolean;
      /** Register pi's builtin MCP extension, replacing the gateway tool. */
      enableMcpNative?: boolean;
    },
    additionalExtensionFactories: PiExtensionFactory[] = [],
  ): Promise<PiResourceLoader> {
    const settingsManager =
      approvalContext?.settingsManager ?? this.createPiSettingsManager(pi, cwd);
    const resourceLoader = new pi.DefaultResourceLoader({
      cwd,
      agentDir: pi.getAgentDir(),
      ...(settingsManager ? { settingsManager } : {}),
      // ZhiYuanAgent skills come exclusively from the app-managed SKILLs dirs —
      // never from the developer's global ~/.agents/skills (which would leak
      // dev-only tooling skills like ai-sdk/shadcn into user sessions).
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      // Work discovers the app-managed skill roots. Chat only loads explicitly
      // selected skills and expert preset roots, so a plain conversation does
      // not scan the full bundled Skill tree during startup.
      additionalSkillPaths: [
        ...(resourceState.chatMode
          ? this.resolveSelectedSkillDirs(resourceState.skillIds)
          : this.resolveZhiyuanSkillDirs()),
        ...resourceState.expertSkillDirs,
      ],
      skillsOverride: (base: {
        skills: Array<{ name?: string; id?: string }>;
        diagnostics: unknown[];
      }) =>
        resourceState.skillIds === undefined
          ? base
          : {
              ...base,
              skills: base.skills.filter(
                skill =>
                  resourceState.skillIds?.includes(skill.id || '') ||
                  resourceState.skillIds?.includes(skill.name || ''),
              ),
            },
      ...createPiPromptOverrides(resourceState, () =>
        collectPiSystemPromptContributions({
          chatMode: resourceState.chatMode,
          fileToolsEnabled: resourceState.fileToolsEnabled,
          maxOutputTokens: resourceState.maxOutputTokens,
          platform: process.platform,
          unattended: resourceState.unattended,
          mcpToolManifest: resourceState.chatMode
            ? []
            : (this.mcpServerManager?.toolManifest ?? []),
          mcpServerStatuses: resourceState.chatMode
            ? []
            : (this.mcpServerManager?.serverStatuses ?? []),
          codemodeEnabled: approvalContext?.enableCodemode === true,
          mcpNativeBridge: approvalContext?.enableMcpNative === true,
        }),
      ),
      extensionFactories: [
        ...(approvalContext?.getRunId()
          ? [
              (extensionApi: PiExtensionApi) => {
                extensionApi.on(PiExtensionEventType.ToolCall, async event => {
                  const runId = approvalContext.getRunId();
                  if (!runId) {
                    return {
                      block: true as const,
                      reason: 'No active workbench run is available.',
                    };
                  }
                  const toolInput =
                    event.input && typeof event.input === 'object'
                      ? (event.input as Record<string, unknown>)
                      : {};
                  const authorization = await this.workbenchTaskService?.authorizeToolCall({
                    sessionId: approvalContext.sessionId,
                    runId,
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    toolInput,
                    approvalMode: approvalContext.getApprovalMode(),
                  });
                  if (!authorization) return undefined;
                  if (authorization.allow) return undefined;
                  if (authorization.terminateRun) {
                    // The run cannot continue: end the turn with a visible error
                    // instead of returning another tool error the model would
                    // answer with yet another tool call.
                    this.recovery.endTerminatedWorkbenchTurn(
                      approvalContext.sessionId,
                      authorization.reason ?? 'The workbench run can no longer continue.',
                    );
                  }
                  return {
                    block: true as const,
                    reason: authorization.reason || 'The action was not approved.',
                  };
                });
              },
            ]
          : []),
        (extensionApi: PiExtensionApi) => {
          extensionApi.on(PiExtensionEventType.ToolCall, event => {
            if (
              event.toolName !== PiBuiltinFileToolName.Bash ||
              !event.input ||
              typeof event.input !== 'object'
            ) {
              return undefined;
            }
            const input = event.input as Record<string, unknown>;
            input.timeout = normalizePiBashTimeoutSeconds(input.timeout);
            const command = (event.input as Record<string, unknown>).command;
            if (typeof command !== 'string') return undefined;
            const reason = getPiBashCommandViolation(command, process.platform, getSkillsRoot());
            return reason ? { block: true as const, reason } : undefined;
          });
        },
        (extensionApi: PiExtensionApi) => {
          extensionApi.on(PiExtensionEventType.ToolCall, event => {
            const planSessionId = approvalContext?.sessionId;
            if (!planSessionId) return undefined;
            if (this.activeSessions.get(planSessionId)?.planMode !== true) return undefined;
            if (event.toolName === PiBuiltinFileToolName.Bash) {
              return {
                block: true as const,
                reason:
                  'Plan mode is read-only: bash is refused because shell commands can modify the workspace. ' +
                  'Use read-only tools, publish the plan with plan_write, and end the turn before implementing.',
              };
            }
            return isPlanModeBlockedTool(event.toolName)
              ? {
                  block: true as const,
                  reason:
                    'Plan mode is read-only: workspace-mutating tools are refused for this turn. ' +
                    'Publish the plan with plan_write and end the turn before implementing.',
                }
              : undefined;
          });
        },
        // Codemode lets the model orchestrate parallel tool calls from a
        // QuickJS sandbox; both extensions register inactive and are activated
        // through the defaultTools override next to the compaction settings.
        ...(approvalContext?.enableCodemode &&
        pi.createCodemodeExtension &&
        pi.createToolSearchExtension
          ? [pi.createCodemodeExtension(), pi.createToolSearchExtension()]
          : []),
        ...(approvalContext?.enableMcpNative && pi.createMcpExtension && this.mcpServerManager
          ? [
              pi.createMcpExtension({
                loadConfig: () =>
                  buildPiLoadedMcpConfig(this.mcpServerManager?.lastEnabledRecords ?? []),
                createTransport: buildPiMcpTransportFactory(
                  () => this.mcpServerManager?.lastEnabledRecords ?? [],
                ),
              }),
            ]
          : []),
        ...additionalExtensionFactories,
      ],
    });
    await resourceLoader.reload();
    // Pi's resource reload refreshes settings from disk, so apply the resolved
    // per-process shell override after reload and share the same manager with
    // createAgentSession. This makes bundled PortableGit usable by every Pi
    // session without changing the user's global Pi settings file.
    this.applyPiShellOverride(settingsManager);
    resourceLoader.settingsManager = settingsManager;
    return resourceLoader;
  }

  /**
   * Skill directories exposed to Pi sessions, in priority order.
   * Development: project-root SKILLs/ (via getSkillsRoot) plus userData/SKILLs
   * (may exist from a previous packaged run). Production: userData/SKILLs only
   * (getSkillsRoot already resolves there).
   */
  private resolveZhiyuanSkillDirs(): string[] {
    const dirs: string[] = [];
    const push = (dir: string): void => {
      if (!dirs.includes(dir) && fs.existsSync(dir)) dirs.push(dir);
    };
    push(getSkillsRoot());
    push(getFeishuConnectorSkillsRoot(app.getPath('userData')));
    if (!app.isPackaged) {
      push(path.join(app.getPath('userData'), 'SKILLs'));
    }
    return dirs;
  }

  /**
   * Resolve only the skill directories explicitly selected for a Chat turn.
   * This performs bounded existence checks instead of enumerating every Skill
   * root, keeping default Chat startup independent of the bundled Skill tree.
   */
  private resolveSelectedSkillDirs(skillIds: string[] | undefined): string[] {
    if (!skillIds?.length) return [];
    const dirs: string[] = [];
    const roots = this.resolveZhiyuanSkillDirs();
    for (const skillId of skillIds) {
      if (!skillId || path.basename(skillId) !== skillId) continue;
      for (const root of roots) {
        const candidate = path.join(root, skillId);
        if (fs.existsSync(path.join(candidate, 'SKILL.md')) && !dirs.includes(candidate)) {
          dirs.push(candidate);
        }
      }
    }
    return dirs;
  }

  /**
   * Bundled preset skill directories for the session's selected experts.
   * File-sourced like regular skills: editing a preset SKILL.md takes effect
   * on the next session. Falls back to the imported userData copies when the
   * preset directory is not present in this build.
   */
  private resolveExpertPresetSkillDirs(expertIds: string[] | undefined): string[] {
    const dirs: string[] = [];
    if (!expertIds?.length) return dirs;
    const skillsRoot = getSkillsRoot();
    for (const expertId of expertIds) {
      const agent = this.store?.getAgent(expertId);
      const presetId = agent?.presetId?.trim();
      if (!presetId) continue;
      const dir = path.join(skillsRoot, 'zhiyuan-expert-manager', 'presets', presetId, 'skills');
      if (!dirs.includes(dir) && fs.existsSync(dir)) dirs.push(dir);
    }
    return dirs;
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

  private createSessionMemoryCompletion(active: ActivePiSession): SessionMemoryCompletion {
    const sessionId = active.sessionId;
    const model = active.model;
    const modelRuntime = active.modelRuntime;
    const modelRequestOptions = active.modelRequestOptions;
    return messages => {
      const previous = this.pendingMemoryCompletions.get(sessionId) ?? Promise.resolve('');
      const current = previous
        .catch(() => '')
        .then(() => this.completeSessionMemory(model, modelRuntime, modelRequestOptions, messages))
        .finally(() => {
          if (this.pendingMemoryCompletions.get(sessionId) === current) {
            this.pendingMemoryCompletions.delete(sessionId);
          }
        });
      this.pendingMemoryCompletions.set(sessionId, current);
      return current;
    };
  }

  getSessionMemoryCompletion(sessionId: string): SessionMemoryCompletion | null {
    const active = this.activeSessions.get(sessionId);
    return active ? this.createSessionMemoryCompletion(active) : null;
  }

  private async runPostTurnMemoryMaintenance(
    sessionId: string,
    workingDirectory: string,
    complete: SessionMemoryCompletion,
  ): Promise<void> {
    if (this.sessionSummaryService) {
      try {
        await this.sessionSummaryService.rollup({ sessionId, workingDirectory, complete });
      } catch (error) {
        console.warn(`[SessionSummary] Failed to roll up session ${sessionId}:`, error);
      }
    }
    if (this.sessionSummaryBackfillService) {
      try {
        await this.sessionSummaryBackfillService.run(complete);
      } catch (error) {
        console.warn('[SessionSummaryBackfill] Failed to run semantic backfill:', error);
      }
    }
  }

  private async completeSessionMemory(
    model: Record<string, unknown>,
    modelRuntime: PiModelRuntime | null,
    modelRequestOptions: { apiKey?: string } | undefined,
    messages: readonly SessionMemoryCompletionMessage[],
  ): Promise<string> {
    const pi = await getPiModules();
    const context = buildPiBackgroundCompletionContext(messages);
    const result = modelRuntime?.completeSimple
      ? await modelRuntime.completeSimple(model, context)
      : await pi.completeSimple(model, context, modelRequestOptions);
    return extractPiBackgroundCompletionText(result);
  }

  async resetImageInputCapabilities(): Promise<void> {
    await this.recovery.resetImageInputCapabilities();
  }

  // ── Skills & MCP integration ──

  /**
   * Build a single MCP proxy tool (pi-mcp-adapter pattern) instead of
   * registering every MCP tool as an individual customTool.
   *
   * One proxy tool costs ~200 system-prompt tokens regardless of how many
   * MCP servers/tools are configured, vs N × ~200 tokens for per-tool
   * registration. Uses ZhiYuanAgent's McpServerManager for tool execution
   * rather than creating duplicate MCP connections.
   */
  private buildMcpProxyTool(): Record<string, unknown> | null {
    if (!this.mcpServerManager) return null;
    return new McpPiAdapter(this.mcpServerManager).buildGatewayTool();
  }

  private getPiAgentsDir(): string {
    const homedir = os.homedir();
    const configDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir, '.pi', 'agent');
    return path.join(configDir, 'agents');
  }

  /**
   * Live team member definitions for bundled presets. Returns null when the
   * preset is not bundled, so the subagent tool falls back to the synced pi
   * agents files (user-imported packages).
   */
  private resolveBundledMemberProfiles(
    presetId: string,
  ): Array<{ id: string; description: string; systemPrompt: string }> | null {
    return resolveBundledPresetMembers(this.bundledSkillsRoot ?? getSkillsRoot(), presetId);
  }
  private createWorkbenchContract(
    sessionMode: PiStartOptions['sessionMode'],
    skillIds: string[] | undefined,
  ): WorkbenchTaskContract {
    const research = isAcademicResearchSkillSet(skillIds);
    const shortcut = research ? null : resolveShortcutWorkflowKind(skillIds);
    const kind =
      sessionMode === CoworkSessionMode.Chat
        ? WorkbenchContractKind.Chat
        : research
          ? WorkbenchContractKind.Research
          : shortcut
            ? WorkbenchContractKind.Shortcut
            : WorkbenchContractKind.GenericWork;
    return {
      kind,
      requiresUserAcceptance: false,
      metadata: {
        ...(skillIds?.length ? { skillIds } : {}),
      },
    };
  }
}
