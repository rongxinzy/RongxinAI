/**
 * Session launch for the Pi runtime adapter.
 *
 * Extracted from PiRuntimeAdapter.startSession: creates the Pi AgentSession
 * for a Cowork turn — resource state, model resolution, settings overrides,
 * custom tools, workbench run bookkeeping, event subscription, and dispatch
 * of the initial (history- and memory-augmented) prompt.
 */

import { randomUUID } from 'crypto';

import { classifyCoworkError } from '../../../common/coworkError';
import { normalizeSingleExpertIds } from '../../../shared/cowork/sessionExperts';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { assertCoworkSubmissionContent } from '../../../shared/cowork/submissionContent';
import {
  HarnessVersion,
  type HarnessActivationEvent,
  type HarnessModelProfileInput,
} from '../../../shared/harness';
import { ZhiyuanModelPoolWorkload } from '../../../shared/modelPool/constants';
import { WorkbenchApprovalMode, WorkbenchRunTrigger } from '../../../shared/workbenchTask';
import { isLocalProviderName, ModelCapabilityStatus } from '../../../shared/providers';
import { agentResourceDiagnostics } from '../../agentResourceDiagnostics';
import type { CoworkMessage } from '../../coworkStore';
import { t } from '../../i18n';
import {
  finalizePiPromptWithProjectMemory,
  resolveProjectMemoryContextForPiPrompt,
} from '../../memory/piRuntimeProjectMemoryPrompt';
import { applyApplicationRuntimeEnv } from '../coworkUtil';
import { PiPlanModePrompt } from './piPlanTool';
import { resolvePiTurnWorkflowSkills } from './piTurnWorkflow';
import { isAcademicResearchSkillSet } from './piResearchRun';
import { resolveShortcutWorkflowKind } from './piShortcutWorkflow';
import { resolvePiSkillRoots } from './piSkillRoots';
import { PiThinkingLifecycle } from './piThinkingLifecycle';
import { PiStreamAccumulator } from './piStreamAccumulator';
import { PiEventProjectionQueue } from './piEventProjectionQueue';
import { ToolActivityTracker } from './toolActivity';
import { PiWriteTokenLimitRecovery } from './piWriteTokenLimit';
import { collectImagePathReferences } from './piImageInputFallback';
import { DEFAULT_PI_LOCAL_MAX_TOKENS, resolvePiModel } from './piMagpiePiModel';
import {
  createPiSettingsManager,
  applyPiCompactionOverrides,
  resolvePiSessionModel,
} from './piRuntimeSettingsOverrides';
import { resolveExpertPresetSkillDirs, resolveZhiyuanSkillDirs } from './piRuntimeSkillDirs';
import { createPiWorkbenchContract } from './piRuntimeWorkbenchContract';
import { createPiRuntimeResourceLoader } from './piRuntimeResourceLoader';
import { buildPiSessionCustomTools } from './piRuntimeSessionCustomTools';
import {
  getPiModules,
  normalizeSkillIds,
  preparePiPrompt,
  sendPiPrompt,
  PiChatRuntimeLimit,
  type ActivePiSession,
  type InitializingPiSession,
  type PiEvent,
  type PiResourceState,
} from './piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import type { PiStartOptions } from './piRuntimeTypes';

// Pi's bash tool inherits the main-process environment. Initialize the
// application-managed runtime once so later session creation cannot duplicate
// PATH entries in process.env.
let hasAppliedApplicationRuntimeEnv = false;

export async function startPiRuntimeSession(
  host: PiRuntimeAdapterHost,
  sessionId: string,
  prompt: string,
  options: PiStartOptions = {},
): Promise<void> {
  assertCoworkSubmissionContent({ prompt, imageAttachments: options.imageAttachments });
  host.evictIdleSessions();
  const expertIds = normalizeSingleExpertIds(options.expertIds);

  if (host.activeSessions.has(sessionId) || host.initializingSessions.has(sessionId)) {
    host.stopActiveSession(sessionId, 'The session was replaced by a new run.', false);
  }

  const abortController = new AbortController();
  const initialization: InitializingPiSession = {
    abortController,
    generation: Symbol(sessionId),
  };
  host.initializingSessions.set(sessionId, initialization);
  const isCurrentInitialization = (): boolean =>
    host.initializingSessions.get(sessionId)?.generation === initialization.generation &&
    !abortController.signal.aborted;

  const pi = await getPiModules();
  if (!isCurrentInitialization()) return;

  // Emit user message to UI (unless the caller already did).
  // Must persist via store.addMessage() — the CoworkStore is the source of
  // truth for messages; emit alone delivers to the in-memory Redux state
  // but never writes to SQLite, causing the prompt to vanish on session switch.
  if (!options.skipInitialUserMessage) {
    const storedImages = host.persistImageAttachments(sessionId, options.imageAttachments);
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
                      host.getStore()?.getSession(sessionId, 0, { includeArtifacts: false })
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
    const store = host.getStore();
    const persisted = store ? store.addMessage(sessionId, userMsg) : userMsg;
    host.emit('message', sessionId, persisted);
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
      expertSkillDirs: resolveExpertPresetSkillDirs(options.expertIds, agentId =>
        host.getStore()?.getAgent(agentId),
      ),
      skillRoots: {},
    };
    resourceState.skillRoots = resolvePiSkillRoots(
      resourceState.skillIds,
      resolveZhiyuanSkillDirs(),
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
    const workbenchContract = createPiWorkbenchContract(options.sessionMode, workflowSkillIds);
    const workbenchTaskService = host.getWorkbenchTaskService();
    if (workbenchTaskService && !chatMode) {
      const workbench = workbenchTaskService.beginRun({
        sessionId,
        goal: prompt,
        contract: workbenchContract,
        trigger: options._workbenchRunId ? WorkbenchRunTrigger.Resume : WorkbenchRunTrigger.Message,
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
    const workbenchForContext = host.getWorkbenchTaskService();
    if (workbenchRunId && workbenchForContext) {
      workbenchForContext.updateRunContext(workbenchRunId, {
        model: harnessModelProfile.model,
        provider: harnessModelProfile.provider,
        reasoningProfile: harnessModelProfile.reasoningProfile,
        workspaceRoot,
        skillIds: resourceState.skillIds ?? [],
      });
      workbenchForContext.measurement?.recordModelProfile(workbenchRunId, harnessModelProfile);
    }
    const recordActivation = (event: HarnessActivationEvent): void => {
      const currentRunId = host.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId;
      if (!currentRunId) return;
      host.getWorkbenchTaskService()?.measurement?.recordActivation(currentRunId, event);
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
    const sessionModel = resolvePiSessionModel(resolvedModel.model, resourceState.chatMode);
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
    const settingsManager = createPiSettingsManager(pi, workspaceRoot);
    const contextWindowTokens =
      typeof resolvedModel.model.contextWindow === 'number'
        ? resolvedModel.model.contextWindow
        : undefined;
    const codemodeEnabled =
      options.codemode === true && !resourceState.chatMode && options.confirmationMode !== 'text';
    const mcpNativeBridge =
      options.mcpNativeBridge === true &&
      !resourceState.chatMode &&
      Boolean(host.getMcpServerManager());
    const resourceLoader = await createPiRuntimeResourceLoader(
      host,
      pi,
      workspaceRoot,
      resourceState,
      {
        sessionId,
        getRunId: () => host.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId,
        settingsManager,
        getApprovalMode: () =>
          host.activeSessions.get(sessionId)?.approvalMode ??
          options.approvalMode ??
          WorkbenchApprovalMode.Ask,
        enableCodemode: codemodeEnabled,
        enableMcpNative: mcpNativeBridge,
      },
    );
    applyPiCompactionOverrides(
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

    const {
      customTools,
      researchRun,
      shortcutWorkflow,
      agentLoop,
      workLoopPrompt,
      shouldRunGoalLoop,
    } = buildPiSessionCustomTools(host, {
      pi,
      sessionId,
      prompt,
      options,
      resourceState,
      resolvedModel,
      workspaceRoot,
      workbenchRunId,
      expertIds,
      workflowSkillIds,
      shortcutKindForContract,
      mcpNativeBridge,
      abortSignal: abortController.signal,
      recordActivation,
    });

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
        host.getStore()?.getSession(sessionId, 0, { includeArtifacts: false })?.experts ?? []
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
      mcpToolManifestGeneration: host.getMcpToolManifestGeneration(),
    };
    activeSession = active;

    // Session ownership stays on main; display transforms preserve SDK event order.
    active.eventProjection = new PiEventProjectionQueue<PiEvent>(
      event => host.turnEvents.handlePiEvent(sessionId, active, event),
      abortController.signal,
      error => console.error(`[PiRuntime] event projection failed in session ${sessionId}:`, error),
    );
    console.debug(
      `[PiRuntime] Pi session created for ${sessionId} in ${piSessionCreatedAt - piSessionCreateStartedAt}ms`,
    );

    // Subscribe to Pi events before sending the prompt
    active.unsubscribe = session.subscribe(event => {
      if (abortController.signal.aborted || host.activeSessions.get(sessionId) !== active) {
        return;
      }
      host.emit('executionEvent', sessionId, event);
      active.eventProjection?.push(event);
    });

    if (!isCurrentInitialization()) {
      active.unsubscribe();
      void session.abort();
      return;
    }
    host.activeSessions.set(sessionId, active);
    agentResourceDiagnostics.startPiTurn(
      sessionId,
      host.activeSessions.size,
      [...host.activeSessions.values()].filter(session => session.isRunning).length,
    );
    host.initializingSessions.delete(sessionId);
    // A live Pi session replaces the lightweight IM retention marker.
    host.retainedSessionIds.delete(sessionId);

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
    host.memoryInjectionDedup.reset(sessionId);
    const projectMemoryContext = await resolveProjectMemoryContextForPiPrompt({
      chatMode: resourceState.chatMode,
      memoryInjectionDedup: host.memoryInjectionDedup,
      projectMemoryService: host.getProjectMemoryService(),
      workspaceRoot,
      sessionId,
      userPrompt: prompt,
    });
    if (host.activeSessions.get(sessionId) !== active || abortController.signal.aborted) return;
    initialPrompt = finalizePiPromptWithProjectMemory({
      chatMode: resourceState.chatMode,
      sessionId,
      userPrompt: prompt,
      prompt: initialPrompt,
      projectMemoryContext,
      workbenchTaskService: host.getWorkbenchTaskService(),
    });

    // The user may stop the session while the execution-mode question is
    // open. Do not revive an aborted Pi turn when that question resolves.
    if (abortController.signal.aborted) return;

    console.debug(`[PiRuntime] dispatching initial prompt for session ${sessionId}`);
    const initialImagePrompt = preparePiPrompt(
      initialPrompt,
      options.imageAttachments,
      host.recovery.imageInputVerdictForActive(active),
      host.getOcrCommandFor(),
      collectImagePathReferences(options.fileAttachments),
    );
    // Recorded before the request leaves: the SDK can report the rejection
    // through events that arrive before the send promise settles.
    host.recovery.recordImagePrompt(sessionId, active, initialPrompt, initialImagePrompt);
    await sendPiPrompt(session, initialImagePrompt, undefined);
    await active.eventProjection?.drain();
    await active.completionPending;
  } catch (error) {
    // A stopped turn can immediately restart from the first queued follow-up.
    // Its eventual abort rejection must not delete that replacement session.
    if (activeSession && host.activeSessions.get(sessionId) === activeSession) {
      host.memoryInjectionDedup.reset(sessionId);
      host.activeSessions.delete(sessionId);
    }
    if (abortController.signal.aborted) {
      host.emit('sessionStopped', sessionId);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    host.getWorkbenchTaskService()?.failRun?.(sessionId, { message });
    host.emit('error', sessionId, classifyCoworkError(message));
    throw error;
  } finally {
    if (host.initializingSessions.get(sessionId)?.generation === initialization.generation) {
      host.initializingSessions.delete(sessionId);
    }
  }
}
