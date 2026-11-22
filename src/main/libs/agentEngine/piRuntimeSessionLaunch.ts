/**
 * Session launch for the Pi runtime adapter.
 *
 * Creates the Pi AgentSession
 * for a Cowork turn — resource state, model resolution, settings overrides,
 * custom tools, workbench run bookkeeping, event subscription, and dispatch
 * of the initial (history- and memory-augmented) prompt.
 */

import { observeWorkbench } from '../../workbenchTask/observe';

import path from 'node:path';

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
import {
  WorkbenchApprovalMode,
  WorkbenchContractKind,
  WorkbenchRunTrigger,
} from '../../../shared/workbenchTask';
import { isLocalProviderName, ModelCapabilityStatus } from '../../../shared/providers';
import { agentResourceDiagnostics } from '../../agentResourceDiagnostics';
import { t } from '../../i18n';
import { resolveProjectMemoryContextForPiPrompt } from '../../memory/piRuntimeProjectMemoryPrompt';
import { applyApplicationRuntimeEnv } from '../coworkUtil';
import { PiAgentEventType } from './piStreamConstants';
import { resolvePiSkillRoots } from './piSkillRoots';
import { PiThinkingLifecycle } from './piThinkingLifecycle';
import { PiStreamAccumulator } from './piStreamAccumulator';
import { createPiTranslatorState } from './piTranslate/piTranslateUiMessageChunk';
import { PiEventProjection } from './piEventProjection';
import { ToolActivityTracker } from './toolActivity';
import { collectImagePathReferences } from './piImageInputFallback';
import {
  compactPiSessionIfOversizedBeforePrompt,
  installPiSessionManagerGuards,
} from './piBoundedCompaction';
import { DEFAULT_PI_LOCAL_MAX_TOKENS, resolvePiModel } from './piMagpiePiModel';
import { PiSkillRuntimeCapabilitiesToolName } from './piSkillRuntimeCapabilitiesTool';
import { PiSkillScriptToolName } from './piSkillScriptTool';
import { createPiSettingsManager } from './piRuntimeSettingsOverrides';
import { resolveExpertPresetSkillDirs, resolveZhiyuanSkillDirs } from './piRuntimeSkillDirs';
import { createPiRuntimeResourceLoader } from './piRuntimeResourceLoader';
import { openPersistentPiSessionManager, PI_COMPANION_SESSIONS_ROOT_DIR } from './piSessionStore';
import { buildPiSessionCustomTools } from './piRuntimeSessionCustomTools';
import {
  getPiModules,
  normalizeSkillIds,
  persistPiUserMessage,
  preparePiPrompt,
  sendPiPrompt,
  type ActivePiSession,
  type InitializingPiSession,
  type PiEvent,
  type PiResourceState,
  type PiSession,
} from './piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import { ArtifactRecorder } from '../../artifactLedger/artifactRecorder';
import { isPiCompanionChatSession, type PiStartOptions } from './piRuntimeTypes';

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
  const companionChat = isPiCompanionChatSession(sessionId);
  const sessionMode = companionChat ? CoworkSessionMode.Chat : options.sessionMode;
  const confirmationMode = companionChat ? 'text' : (options.confirmationMode ?? 'modal');
  const abortController = new AbortController();
  const initialization: InitializingPiSession = {
    abortController,
    generation: Symbol(sessionId),
    onSettled: options.onSettled,
    workbenchRunId: options.workbenchReservation?.runId,
  };
  const isCurrentInitialization = (): boolean =>
    host.initializingSessions.get(sessionId)?.generation === initialization.generation &&
    !abortController.signal.aborted;

  let activeSession: ActivePiSession | null = null;
  let unregisteredSession: PiSession | undefined;
  let nativeAcquisition: PromiseWithResolvers<void> | undefined;

  try {
    assertCoworkSubmissionContent({ prompt, imageAttachments: options.imageAttachments });
    if (!companionChat) {
      const capture = host.waitForPriorArtifactCapture(sessionId);
      if (capture) await capture;
    }
    host.evictIdleSessions();
    const expertIds = normalizeSingleExpertIds(options.expertIds);

    if (
      host.isSessionRunning(sessionId) &&
      (options.onSettled ||
        host.activeSessions.get(sessionId)?.onSettled ||
        host.initializingSessions.get(sessionId)?.onSettled)
    ) {
      throw new Error('A Pi run is already active in this session.');
    }
    if (host.activeSessions.has(sessionId) || host.initializingSessions.has(sessionId)) {
      host.stopActiveSession(sessionId, 'The session was replaced by a new run.');
    }

    host.initializingSessions.set(sessionId, initialization);
    const priorStop = host.waitForNativeSessionStop(sessionId);
    if (priorStop) await priorStop;
    if (!isCurrentInitialization()) return;
    const pi = await getPiModules();
    if (!isCurrentInitialization()) return;

    const selectedExpertId = expertIds[0];
    const expertSession = selectedExpertId
      ? host
          .getStore(sessionId)
          ?.getSessionExperts(sessionId)
          .find(row => row.expertId === selectedExpertId)
      : undefined;
    const turnExperts = expertSession
      ? [
          {
            expertId: expertSession.expertId,
            expertName: expertSession.expertName,
            presetId: expertSession.packageId,
          },
        ]
      : [];

    let imageAttachments = options.imageAttachments;
    if (!companionChat && !options.skipInitialUserMessage) {
      imageAttachments = imageAttachments?.length
        ? await host.persistImageAttachments(
            sessionId,
            imageAttachments,
            abortController.signal,
            isCurrentInitialization,
          )
        : undefined;
      if (!isCurrentInitialization()) return;
      assertCoworkSubmissionContent({ prompt, imageAttachments });
      persistPiUserMessage(host, sessionId, prompt, {
        skillIds: options.attachedSkillIds,
        imageAttachments,
        fileAttachments: options.fileAttachments,
        experts: expertIds.length ? turnExperts : undefined,
      });
    }

    const workspaceRoot = companionChat
      ? path.parse(process.cwd()).root
      : options.workspaceRoot || process.cwd();
    // Pi's built-in shell tools snapshot process.env when they execute. Give
    // that snapshot the same app-managed Node/npm, Python, and uv
    // PATH configuration used by direct Skill execution.
    if (!companionChat && !hasAppliedApplicationRuntimeEnv) {
      await applyApplicationRuntimeEnv(process.env as Record<string, string | undefined>);
      hasAppliedApplicationRuntimeEnv = true;
    }
    const sessionOptions: Record<string, unknown> = { cwd: workspaceRoot };
    // Rebuilds reopen only the native history owned by this SQLite row.
    const piSessionStoreRoot = host.getPiSessionStoreRoot();
    const historyStore = piSessionStoreRoot ? host.getStore(sessionId) : null;
    const piHistoryKey = historyStore ? historyStore.getPiHistoryKey(sessionId) : null;
    const historyRestoreStartedAt = Date.now();
    let restoredNativeHistory = false;
    if (
      piSessionStoreRoot &&
      piHistoryKey !== undefined &&
      pi.SessionManager?.create &&
      pi.SessionManager?.open
    ) {
      const persisted = await openPersistentPiSessionManager(
        pi.SessionManager,
        companionChat
          ? path.join(piSessionStoreRoot, PI_COMPANION_SESSIONS_ROOT_DIR)
          : piSessionStoreRoot,
        sessionId,
        workspaceRoot,
        abortController.signal,
        piHistoryKey,
      );
      if (!isCurrentInitialization()) return;
      sessionOptions.sessionManager = persisted.manager;
      restoredNativeHistory = persisted.reusedFile;
    } else if (pi.SessionManager?.inMemory) {
      const memoryManager = pi.SessionManager.inMemory(workspaceRoot);
      installPiSessionManagerGuards(memoryManager);
      sessionOptions.sessionManager = memoryManager;
    }

    // System prompt — user config only. Skills are discovered and appended
    // by the resource loader (additionalSkillPaths), which renders them via
    // pi's formatSkillsForPrompt — no manual injection here to avoid
    // duplicating the skills section.
    const basePrompt = options.systemPrompt?.trim() || '';
    // Experts bind skills as part of their definition; load them alongside
    // the caller's picks without changing sessions that have no expert.
    const effectiveSkillIds = expertSession?.skillIds?.length
      ? normalizeSkillIds([...(options.skillIds ?? []), ...expertSession.skillIds])
      : normalizeSkillIds(options.skillIds);
    const chatMode = sessionMode === CoworkSessionMode.Chat;
    const resourceState: PiResourceState = {
      companionChat: companionChat || undefined,
      systemPrompt: basePrompt,
      skillIds: effectiveSkillIds,
      maxOutputTokens: DEFAULT_PI_LOCAL_MAX_TOKENS,
      fileToolsEnabled: confirmationMode !== 'text',
      unattended: options.unattended === true,
      chatMode,
      expertSkillDirs: resolveExpertPresetSkillDirs(expertIds, agentId =>
        host.getStore(sessionId)?.getAgent(agentId),
      ),
      skillRoots: {},
    };
    if (!companionChat) {
      resourceState.skillRoots = resolvePiSkillRoots(
        resourceState.skillIds,
        resolveZhiyuanSkillDirs(),
        resourceState.expertSkillDirs,
      );
    }

    const workflowKind = chatMode ? WorkbenchContractKind.Chat : WorkbenchContractKind.GenericWork;
    const workbenchRunId = chatMode
      ? null
      : (observeWorkbench(
          sessionId,
          () =>
            host.getWorkbenchTaskService(sessionId)?.beginRun({
              sessionId,
              goal: prompt,
              contract: { kind: workflowKind },
              trigger: WorkbenchRunTrigger.Message,
              reservation: options.workbenchReservation,
            }).run.id,
        ) ?? null);
    if (workbenchRunId) initialization.workbenchRunId = workbenchRunId;

    // Pi's createAgentSession does not accept a systemPrompt option. Its
    // default resource loader supplies the Pi Coding Assistant identity,
    // so override that loader per session to keep expert contexts isolated.
    // Resolve model early — needed by both MCP proxy and subagent tool
    const resolvedModel = await resolvePiModel(
      pi,
      host.modelService,
      options.modelOverride,
      undefined,
      {
        conversationId: sessionId,
        workload: chatMode ? ZhiyuanModelPoolWorkload.Chat : ZhiyuanModelPoolWorkload.Work,
        requirePublishedModel: companionChat && Boolean(options.modelOverride),
      },
    );
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
      workflowKind,
      harnessVersion: HarnessVersion,
    };
    observeWorkbench(sessionId, () => {
      const workbenchForContext = host.getWorkbenchTaskService(sessionId);
      if (workbenchRunId && workbenchForContext) {
        workbenchForContext.updateRunContext(
          workbenchRunId,
          {
            model: harnessModelProfile.model,
            provider: harnessModelProfile.provider,
            reasoningProfile: harnessModelProfile.reasoningProfile,
            workspaceRoot,
            skillIds: resourceState.skillIds ?? [],
          },
          { workflowKind, harnessVersion: HarnessVersion },
        );
      }
    });
    const recordActivation = (event: HarnessActivationEvent): void => {
      const currentRunId = host.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId;
      if (!currentRunId) return;
      observeWorkbench(sessionId, () => {
        host.getWorkbenchTaskService(sessionId)?.measurement?.recordActivation(currentRunId, event);
      });
    };
    if (
      sessionMode === CoworkSessionMode.Work &&
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
    const sessionModel = resolvedModel.model;
    sessionOptions.model = sessionModel;
    const effectiveThinkingLevel =
      options.thinkingLevel ??
      (options.goalMode === true && !resourceState.chatMode ? 'high' : undefined);
    if (effectiveThinkingLevel) {
      // Pi clamps the level to what the resolved model actually supports.
      sessionOptions.thinkingLevel = effectiveThinkingLevel;
    }
    sessionOptions.modelRuntime = resolvedModel.modelRuntime;

    console.debug(`[PiRuntime] loading isolated resources for session ${sessionId}`);
    const settingsManager = createPiSettingsManager(
      pi,
      workspaceRoot,
      () => sessionOptions.sessionManager,
    );
    const codemodeEnabled =
      options.codemode === true && !resourceState.chatMode && confirmationMode !== 'text';
    const expertMcpIds = Array.isArray(expertSession?.capabilityPolicy?.mcpIds)
      ? (expertSession.capabilityPolicy.mcpIds as string[])
      : [];
    const mcpConfigGeneration = host.getMcpConfigGeneration();
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
        expertMcpIds,
      },
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

    const customTools = companionChat
      ? []
      : (
          await buildPiSessionCustomTools(host, {
            pi,
            sessionId,
            options,
            resourceState,
            resolvedModel,
            workspaceRoot,
            workbenchRunId,
            expertIds,
            abortSignal: abortController.signal,
            recordActivation,
          })
        ).customTools;
    if (!isCurrentInitialization()) return;

    if (customTools.length > 0) {
      sessionOptions.customTools = customTools;
    }

    // Chat mode: disable all built-in tools for direct LLM access
    if (confirmationMode === 'text') {
      sessionOptions.noTools = 'all';
    } else {
      const readOnlyWorkspace = options.planMode === true || options.readOnlyWorkspace === true;
      const hasSelectableSkills =
        resourceState.skillIds === undefined || resourceState.skillIds.length > 0;
      const activeCustomToolNames = customTools
        .map(t => (t as { name: string }).name)
        .filter(
          name =>
            hasSelectableSkills ||
            (name !== PiSkillScriptToolName && name !== PiSkillRuntimeCapabilitiesToolName),
        );
      if (readOnlyWorkspace) {
        sessionOptions.tools = ['read', 'grep', 'find', 'ls', ...activeCustomToolNames];
      } else {
        // Use +modifiers so platform defaultTools (powershell on Windows, bash on POSIX,
        // plus optional +codemode) stay intact rather than being replaced by a plain list.
        sessionOptions.tools = [
          '+grep',
          '+find',
          '+ls',
          ...activeCustomToolNames.map(name => `+${name}`),
        ];
        if (process.platform === 'win32') {
          // Ensure resumed transcripts never reactivate bash on Windows.
          sessionOptions.excludeTools = ['bash'];
        }
      }
    }

    const piSessionCreateStartedAt = Date.now();
    console.debug(`[PiRuntime] creating agent session for ${sessionId}`);
    nativeAcquisition = Promise.withResolvers<void>();
    initialization.nativeAcquisition = nativeAcquisition.promise;
    void nativeAcquisition.promise.catch(error => {
      console.warn(`[PiRuntime] Failed to dispose an unregistered session ${sessionId}:`, error);
    });
    const result = await pi.createAgentSession(sessionOptions);
    const session = (unregisteredSession = result.session);
    if (!isCurrentInitialization()) return;
    if (restoredNativeHistory) {
      agentResourceDiagnostics.recordPiHistoryRestored(sessionId, {
        source: 'jsonl',
        messageCount: session.messages?.length,
        promptChars: prompt.length,
        restoreMs: Date.now() - historyRestoreStartedAt,
        contextWindow:
          typeof sessionModel.contextWindow === 'number' ? sessionModel.contextWindow : undefined,
        model: modelId,
      });
    }
    if (!resourceState.chatMode && typeof session.bindExtensions === 'function') {
      // Pi's builtin MCP extension connects servers on session_start; without
      // an explicit bind, SDK sessions never emit it.
      await session.bindExtensions({});
    }
    const piSessionCreatedAt = Date.now();
    if (!isCurrentInitialization()) return;

    const active: ActivePiSession = {
      sessionId,
      piSession: session,
      abortController,
      model: sessionModel,
      modelRuntime: resolvedModel.modelRuntime,
      isCurrentModelRoute: resolvedModel.isCurrentModelRoute,
      revalidateModelScope: resolvedModel.revalidateModelScope,
      codemodeEnabled,
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
      requestedExpertIds: expertIds,
      turnExperts,
      resourceState,
      assistantMessageId: null,
      thinkingMessageId: null,
      answerText: '',
      thinkingText: '',
      streamAccumulator: new PiStreamAccumulator(),
      piTranslatorState: createPiTranslatorState(),
      thinkingLifecycle: new PiThinkingLifecycle(),
      lastCompletedAnswerMessageId: null,
      lastCompletedAnswerText: '',
      onSettled: options.onSettled,
      submissionToken: Symbol(),
      summaryCheckpointGoal: prompt,
      requestStartedAt: null,
      firstVisibleTextAt: null,
      piSessionCreatedAt,
      agentStartedAt: null,
      startupLatencyRecorded: false,
      confirmationMode,
      unsubscribe: () => {},
      aborted: false,
      toolResultMessageIdByCallId: new Map(),
      toolStartedAtByCallId: new Map(),
      preparingToolCallIdByContentIndex: new Map(),
      toolActivityTracker: new ToolActivityTracker(),
      goalMode: options.goalMode === true,
      planMode: options.planMode === true,
      pendingSkillReload: false,
      pendingError: null,
      errorSurfaced: false,
      retryNoticeEmitted: false,
      retryAttempts: 0,
      retryStreamReusePending: false,
      retryPriorAnswer: '',
      workbenchRunId,
      workspaceRoot,
      artifactRecorder: createArtifactRecorderForSession(
        host,
        sessionId,
        workspaceRoot,
        resourceState,
      ),
      sessionManager: sessionOptions.sessionManager,
      settingsManager,
      approvalMode: options.approvalMode ?? WorkbenchApprovalMode.Ask,
      unattended: resourceState.unattended,
      scheduledTaskRun: options.scheduledTaskRun === true,
      isRunning: true,
      lastUsedAt: Date.now(),
      turnFailed: false,
      controlActionInFlight: false,
      mcpConfigGeneration,
    };
    activeSession = active;

    // Session ownership stays on main; display transforms preserve SDK event order.
    active.eventProjection = new PiEventProjection<PiEvent>(
      [
        event => {
          if (event.type === PiAgentEventType.CompactionEnd && event.result) {
            host.memoryInjectionDedup.reset(sessionId);
          }
        },
        event => host.emit('executionEvent', sessionId, event, active.workbenchRunId),
        event => host.turnEvents.handlePiEvent(sessionId, active, event),
      ],
      abortController.signal,
      error => console.warn(`[PiRuntime] event projection failed in session ${sessionId}:`, error),
    );
    console.debug(
      `[PiRuntime] Pi session created for ${sessionId} in ${piSessionCreatedAt - piSessionCreateStartedAt}ms`,
    );

    // Subscribe to Pi events before sending the prompt
    active.unsubscribe = session.subscribe(event => {
      if (abortController.signal.aborted || host.activeSessions.get(sessionId) !== active) {
        return;
      }
      active.eventProjection?.push(event);
    });

    if (!isCurrentInitialization()) {
      active.unsubscribe();
      return;
    }
    host.activeSessions.set(sessionId, active);
    unregisteredSession = undefined;
    nativeAcquisition.resolve();
    nativeAcquisition = undefined;
    const projectMemoryService = companionChat ? null : host.getProjectMemoryService();
    if (projectMemoryService && typeof projectMemoryService.registerSession === 'function') {
      void projectMemoryService
        .registerSession(sessionId, active.workspaceRoot)
        .catch(error => console.warn('[SessionResume] registration failed:', error));
    }
    agentResourceDiagnostics.startPiTurn(
      sessionId,
      host.activeSessions.size,
      [...host.activeSessions.values()].filter(session => session.isRunning).length,
    );
    host.initializingSessions.delete(sessionId);
    // A live Pi session replaces the lightweight IM retention marker.
    host.retainedSessionIds.delete(sessionId);

    // A fresh Pi transcript never contains an earlier memory block, so the
    // per-session dedup fingerprint must restart with it.
    host.memoryInjectionDedup.reset(sessionId);
    const submissionToken = active.submissionToken;
    const isCurrentTurn = () =>
      host.activeSessions.get(sessionId) === active &&
      active.submissionToken === submissionToken &&
      !abortController.signal.aborted;
    const projectMemoryContext = await resolveProjectMemoryContextForPiPrompt({
      chatMode: resourceState.chatMode,
      projectMemoryService,
      workspaceRoot,
      sessionId,
      userPrompt: prompt,
      signal: abortController.signal,
    });
    if (!isCurrentTurn()) return;
    active.pendingTurnMemory = { userPrompt: prompt, context: projectMemoryContext };

    const preparation = preparePiPrompt(
      prompt,
      imageAttachments,
      host.recovery.imageInputVerdictForActive(active),
      companionChat ? undefined : host.getOcrCommandFor(),
      collectImagePathReferences(options.fileAttachments),
      abortController.signal,
    );
    const initialImagePrompt = preparation instanceof Promise ? await preparation : preparation;
    if (!isCurrentTurn()) return;
    await compactPiSessionIfOversizedBeforePrompt({
      session,
      sessionManager: sessionOptions.sessionManager,
      settingsManager,
      model: sessionModel,
      promptText:
        typeof initialImagePrompt.content === 'string' ? initialImagePrompt.content : prompt,
      active,
    });
    if (!isCurrentTurn()) return;
    console.debug(`[PiRuntime] dispatching initial prompt for session ${sessionId}`);
    host.recovery.reportOmittedImages(sessionId, initialImagePrompt);
    await sendPiPrompt(session, initialImagePrompt, undefined);
  } catch (error) {
    const cancelled = abortController.signal.aborted;
    const ownsActiveSession = activeSession && host.activeSessions.get(sessionId) === activeSession;
    const reportError = isCurrentInitialization() || ownsActiveSession;
    // A stopped turn can immediately restart from the first queued follow-up.
    // Its eventual abort rejection must not delete that replacement session.
    if (ownsActiveSession) {
      activeSession.artifactRecorder?.dispose();
      host.stopNativeSession(sessionId, activeSession);
      host.memoryInjectionDedup.reset(sessionId);
      host.activeSessions.delete(sessionId);
    }
    // The stop path already reported cancellation. This promise can finish
    // after a replacement starts under the same session ID.
    if (cancelled) return;
    const message = error instanceof Error ? error.message : String(error);
    host.recovery.failWorkbenchRun(sessionId, initialization.workbenchRunId, message);
    if (reportError) host.recovery.reportSessionError(sessionId, classifyCoworkError(message));
    throw error;
  } finally {
    try {
      unregisteredSession?.dispose?.();
      nativeAcquisition?.resolve();
    } catch (error) {
      nativeAcquisition?.reject(error);
    }
    if (host.initializingSessions.get(sessionId)?.generation === initialization.generation) {
      host.initializingSessions.delete(sessionId);
    }
  }
}

/** Recorder factory: artifact capture is active only for Work-mode sessions
 * with file tools enabled, a workspace root, and a host-provided ledger. */
function createArtifactRecorderForSession(
  host: PiRuntimeAdapterHost,
  sessionId: string,
  workspaceRoot: string,
  resourceState: PiResourceState,
): ArtifactRecorder | null {
  if (resourceState.chatMode || !resourceState.fileToolsEnabled) return null;
  if (!workspaceRoot) return null;
  const ledger = host.getArtifactLedger();
  if (!ledger) return null;
  return new ArtifactRecorder({ sessionId, workspaceRoot, ledger });
}
