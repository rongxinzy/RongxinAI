/**
 * Session continuation for the Pi runtime adapter.
 *
 * Extracted from PiRuntimeAdapter.continueSession/patchSession: drives a
 * follow-up turn on a live Pi session — deciding whether the session can be
 * reused or must be recreated (workspace/model/skills/MCP topology/unattended changes
 * restore history from the store), reloading resources, running the workbench
 * run bookkeeping, and dispatching the next prompt. patchSession swaps the
 * model or thinking level of a live session in place.
 */

import { observeWorkbench } from '../../workbenchTask/observe';

import { classifyCoworkError } from '../../../common/coworkError';
import { normalizeSingleExpertIds } from '../../../shared/cowork/sessionExperts';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { assertCoworkSubmissionContent } from '../../../shared/cowork/submissionContent';
import { HarnessVersion } from '../../../shared/harness';
import { ZhiyuanModelPoolWorkload } from '../../../shared/modelPool/constants';
import { WorkbenchContractKind, WorkbenchRunTrigger } from '../../../shared/workbenchTask';
import { resolveProjectMemoryContextForPiPrompt } from '../../memory/piRuntimeProjectMemoryPrompt';
import { compactPiSessionIfOversizedBeforePrompt } from './piBoundedCompaction';
import { collectImagePathReferences } from './piImageInputFallback';
import { resolvePiModel } from './piMagpiePiModel';
import { resolveZhiyuanSkillDirs } from './piRuntimeSkillDirs';
import { resolvePiSkillRoots } from './piSkillRoots';
import {
  getPiModules,
  haveSameStringList,
  normalizeSkillIds,
  persistPiUserMessage,
  preparePiPrompt,
  sendPiPrompt,
} from './piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import {
  isPiCompanionChatSession,
  type PiContinueOptions,
  type PiSessionPatch,
} from './piRuntimeTypes';

export async function continuePiRuntimeSession(
  host: PiRuntimeAdapterHost,
  sessionId: string,
  prompt: string,
  options: Omit<PiContinueOptions, 'companionChat'> = {},
): Promise<void> {
  assertCoworkSubmissionContent({ prompt, imageAttachments: options.imageAttachments });
  const companionChat = isPiCompanionChatSession(sessionId);
  if (!companionChat) {
    const capture = host.waitForPriorArtifactCapture(sessionId);
    if (capture) await capture;
  }
  host.evictIdleSessions();
  const explicitExpertIds = normalizeSingleExpertIds(options.expertIds);
  const nextUnattended = options.unattended === true;
  const active = host.activeSessions.get(sessionId);
  if (active && !active.aborted && active.piSession.isCompacting) {
    throw new Error('Cannot submit a prompt while compaction is in progress.');
  }
  if (
    active?.revalidatingModelScope ||
    (host.isSessionRunning(sessionId) &&
      (options.onSettled ||
        active?.onSettled ||
        host.initializingSessions.get(sessionId)?.onSettled))
  ) {
    throw new Error('A Pi run is already active in this session.');
  }
  if (!active || active.aborted) {
    if (active?.aborted) {
      host.activeSessions.delete(sessionId);
    }
    console.log(
      `[PiRuntime] continueSession: session ${sessionId} not active or was aborted, recreating session`,
    );
    const storedSession = host
      .getStore(sessionId)
      ?.getSession(sessionId, 0, { includeArtifacts: false });
    const chatMode =
      options.sessionMode === CoworkSessionMode.Chat ||
      storedSession?.mode === CoworkSessionMode.Chat;
    return await host.launchSession(sessionId, prompt, {
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
    });
  }

  const requestedSystemPrompt = options.systemPrompt?.trim();
  const requestedSkillIds =
    options.skillIds === undefined ? active.requestedSkillIds : normalizeSkillIds(options.skillIds);
  const requestedExpertIds =
    options.expertIds === undefined ? active.requestedExpertIds : explicitExpertIds;
  const requestedSessionMode =
    options.sessionMode ??
    (active.resourceState.chatMode ? CoworkSessionMode.Chat : CoworkSessionMode.Work);
  const nextGoalMode = options.goalMode ?? active.goalMode;
  const nextCodemode = options.codemode ?? active.codemodeEnabled;
  // Plan mode is per-turn: an ordinary follow-up clears it again.
  const nextPlanMode = options.planMode === true;
  const mcpConfigGeneration = host.getMcpConfigGeneration();
  const mcpConfigurationChanged =
    !active.resourceState.chatMode && active.mcpConfigGeneration !== mcpConfigGeneration;
  const unattendedTopologyChanged = nextUnattended !== active.unattended;
  const modelRouteChanged = !active.isRunning && !active.isCurrentModelRoute();
  // Native tools and resources capture cwd at creation. Reopen the same Pi
  // transcript with the new workspace rather than changing adapter metadata.
  if (
    (options.workspaceRoot !== undefined && options.workspaceRoot !== active.workspaceRoot) ||
    (options.modelOverride !== undefined &&
      options.modelOverride !== active.requestedModelOverride) ||
    !haveSameStringList(requestedExpertIds, active.requestedExpertIds) ||
    nextCodemode !== active.codemodeEnabled ||
    unattendedTopologyChanged ||
    modelRouteChanged
  ) {
    host.disposeSessionForRecreation(sessionId, active);
    return await host.launchSession(sessionId, prompt, {
      ...options,
      sessionMode: requestedSessionMode,
      workspaceRoot: options.workspaceRoot ?? active.workspaceRoot,
      modelOverride:
        options.modelOverride ??
        active.requestedModelOverride ??
        (modelRouteChanged && typeof active.model.id === 'string' ? active.model.id : undefined),
      approvalMode: options.approvalMode ?? active.approvalMode,
      confirmationMode: active.confirmationMode,
      skipInitialUserMessage: options._skipUserMessage,
      systemPrompt: requestedSystemPrompt ?? active.requestedSystemPrompt,
      skillIds: requestedSkillIds,
      expertIds: requestedExpertIds,
      goalMode: nextGoalMode,
      codemode: nextCodemode,
      unattended: nextUnattended,
    });
  }

  const nextSystemPrompt = requestedSystemPrompt ?? active.requestedSystemPrompt;
  const promptChanged = nextSystemPrompt !== active.requestedSystemPrompt;
  const skillsChanged = !haveSameStringList(requestedSkillIds, active.requestedSkillIds);
  const nextSkillRoots = skillsChanged
    ? resolvePiSkillRoots(
        requestedSkillIds,
        resolveZhiyuanSkillDirs(),
        active.resourceState.expertSkillDirs,
      )
    : active.resourceState.skillRoots;
  const cadToolChanged =
    Boolean(nextSkillRoots['text-to-cad']) !==
    Boolean(active.resourceState.skillRoots['text-to-cad']);

  // Chat sessions filter `additionalSkillPaths` at ResourceLoader creation and
  // CAD custom tool registration is decided once at createAgentSession. Work-mode
  // skill changes reload in place without tearing down the Pi session or MCPs.
  if (
    (skillsChanged && (active.resourceState.chatMode || cadToolChanged)) ||
    (active.pendingCadToolReload && nextSkillRoots['text-to-cad'])
  ) {
    host.disposeSessionForRecreation(sessionId, active);
    return await host.launchSession(sessionId, prompt, {
      ...options,
      sessionMode: requestedSessionMode,
      skipInitialUserMessage: options._skipUserMessage,
      systemPrompt: nextSystemPrompt,
      skillIds: requestedSkillIds,
      expertIds: requestedExpertIds,
      goalMode: nextGoalMode,
      codemode: nextCodemode,
      unattended: nextUnattended,
    });
  }

  const signal = active.abortController.signal;
  const isCurrentSession = () => host.activeSessions.get(sessionId) === active && !signal.aborted;
  if (!active.isRunning && active.revalidateModelScope) {
    active.revalidatingModelScope = true;
    active.onSettled = options.onSettled;
    try {
      await active.revalidateModelScope();
    } catch (error) {
      if (!isCurrentSession()) return;
      active.onSettled = undefined;
      throw error;
    } finally {
      active.revalidatingModelScope = false;
    }
    if (!isCurrentSession()) return;
  }

  if (options.approvalMode !== undefined) {
    active.approvalMode = options.approvalMode;
  }
  active.isRunning = true;
  active.onSettled = options.onSettled;
  const submissionToken = Symbol();
  active.submissionToken = submissionToken;
  const isCurrentTurn = () => isCurrentSession() && active.submissionToken === submissionToken;
  active.turnFailed = false;
  active.errorSurfaced = false;
  active.retryNoticeEmitted = false;
  active.retryAttempts = 0;

  active.goalMode = nextGoalMode;
  active.planMode = nextPlanMode;
  active.scheduledTaskRun = options.scheduledTaskRun === true;

  if (
    promptChanged ||
    skillsChanged ||
    active.pendingSkillReload === true ||
    mcpConfigurationChanged
  ) {
    const previousSystemPrompt = active.resourceState.systemPrompt;
    const previousSkillIds = active.resourceState.skillIds;
    const previousSkillRoots = active.resourceState.skillRoots;
    active.resourceState.systemPrompt = nextSystemPrompt;
    active.resourceState.skillIds = requestedSkillIds;
    active.resourceState.skillRoots = nextSkillRoots;
    try {
      // Pi reloads the existing ResourceLoader without replacing transcript
      // state, model, MCP tools, or custom expert tools.
      await active.piSession.reload();
      if (!isCurrentTurn()) return;
      active.requestedSystemPrompt = nextSystemPrompt;
      active.requestedSkillIds = requestedSkillIds;
      active.pendingSkillReload = false;
      if (mcpConfigurationChanged) {
        active.mcpConfigGeneration = mcpConfigGeneration;
        console.debug('[PiRuntime] reloaded session after MCP configuration changed');
      }
      console.debug('[PiRuntime] reloaded session resources after prompt or skill change');
    } catch (error) {
      if (!isCurrentTurn()) return;
      active.resourceState.systemPrompt = previousSystemPrompt;
      active.resourceState.skillIds = previousSkillIds;
      active.resourceState.skillRoots = previousSkillRoots;
      active.isRunning = false;
      active.onSettled = undefined;
      const message = error instanceof Error ? error.message : String(error);
      host.recovery.reportSessionError(sessionId, classifyCoworkError(message));
      throw error;
    }
  }

  active.workbenchRunId = null;
  observeWorkbench(sessionId, () => {
    const workbenchTaskService = host.getWorkbenchTaskService(sessionId);
    if (workbenchTaskService && !active.resourceState.chatMode) {
      const workflowKind = WorkbenchContractKind.GenericWork;
      const workbench = workbenchTaskService.beginRun(
        {
          sessionId,
          goal: prompt,
          contract: { kind: workflowKind },
          trigger: WorkbenchRunTrigger.Message,
        },
        {
          context: {
            model: active.harnessModelProfile.model,
            provider: active.harnessModelProfile.provider,
            reasoningProfile: active.harnessModelProfile.reasoningProfile,
            workspaceRoot: active.workspaceRoot,
            skillIds: requestedSkillIds,
          },
          profile: { workflowKind, harnessVersion: active.harnessModelProfile.harnessVersion },
        },
      );
      active.workbenchRunId = workbench.run.id;
    }
  });
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
  if (clearActivity) host.emit('toolActivity', sessionId, clearActivity);
  active.pendingError = null;
  active.turnFailed = false;
  active.errorSurfaced = false;
  active.retryNoticeEmitted = false;
  active.retryAttempts = 0;
  active.retryStreamReusePending = false;
  active.summaryCheckpointWritten = false;
  active.summaryCheckpointSkipped = undefined;
  active.summaryCheckpointWorkVersion = undefined;
  active.summaryCheckpointGoal = prompt;
  active.turnExperts = (
    active.requestedExpertIds.length
      ? (host.getStore(sessionId)?.getSessionExperts(sessionId) ?? [])
      : []
  )
    .filter(expert => active.requestedExpertIds.includes(expert.expertId))
    .map(expert => ({
      expertId: expert.expertId,
      expertName: expert.expertName,
      presetId: expert.packageId,
    }));

  try {
    let imageAttachments = options.imageAttachments;
    if (!companionChat && !options._skipUserMessage) {
      imageAttachments = imageAttachments?.length
        ? await host.persistImageAttachments(sessionId, imageAttachments, signal, isCurrentTurn)
        : undefined;
      if (!isCurrentTurn()) return;
      assertCoworkSubmissionContent({ prompt, imageAttachments });
      persistPiUserMessage(host, sessionId, prompt, {
        skillIds: options.attachedSkillIds,
        imageAttachments,
        fileAttachments: options.fileAttachments,
        experts: active.turnExperts.length ? active.turnExperts : undefined,
      });
    }

    const projectMemoryContext = await resolveProjectMemoryContextForPiPrompt({
      chatMode: active.resourceState.chatMode,
      projectMemoryService: companionChat ? null : host.getProjectMemoryService(),
      workspaceRoot: active.workspaceRoot,
      sessionId,
      userPrompt: prompt,
      signal,
    });
    if (!isCurrentTurn()) return;
    active.pendingTurnMemory = { userPrompt: prompt, context: projectMemoryContext };
    const preparation = preparePiPrompt(
      prompt,
      imageAttachments,
      host.recovery.imageInputVerdictForActive(active),
      companionChat ? undefined : host.getOcrCommandFor(),
      collectImagePathReferences(options.fileAttachments),
      signal,
    );
    const continuedImagePrompt = preparation instanceof Promise ? await preparation : preparation;
    if (!isCurrentTurn()) return;
    await compactPiSessionIfOversizedBeforePrompt({
      session: active.piSession,
      sessionManager: active.sessionManager,
      settingsManager: active.settingsManager,
      model: active.model,
      promptText:
        typeof continuedImagePrompt.content === 'string' ? continuedImagePrompt.content : prompt,
      active,
    });
    if (!isCurrentTurn()) return;
    host.recovery.reportOmittedImages(sessionId, continuedImagePrompt);
    await sendPiPrompt(active.piSession, continuedImagePrompt);
  } catch (error) {
    if (!isCurrentTurn()) return;
    active.pendingTurnMemory = undefined;
    active.isRunning = false;
    active.onSettled = undefined;
    const message = error instanceof Error ? error.message : String(error);
    host.recovery.failWorkbenchRun(sessionId, active.workbenchRunId, message);
    host.recovery.reportSessionError(sessionId, classifyCoworkError(message));
    throw error;
  }
}

export async function patchPiRuntimeSession(
  host: PiRuntimeAdapterHost,
  sessionId: string,
  patch: PiSessionPatch,
): Promise<void> {
  const active = host.activeSessions.get(sessionId);
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

  const pi = await getPiModules();
  const resolvedModel = await resolvePiModel(
    pi,
    host.modelService,
    patch.model,
    active.modelRuntime,
    {
      conversationId: sessionId,
      workload: active.resourceState.chatMode
        ? ZhiyuanModelPoolWorkload.Chat
        : ZhiyuanModelPoolWorkload.Work,
    },
  );
  const model = resolvedModel.model;
  await active.piSession.setModel(model);
  active.model = model;
  active.requestedModelOverride = patch.model;
  active.modelRuntime = resolvedModel.modelRuntime;
  active.isCurrentModelRoute = resolvedModel.isCurrentModelRoute;
  active.revalidateModelScope = resolvedModel.revalidateModelScope;
  active.capabilities = {
    ...active.capabilities,
    ...resolvedModel.capabilities,
  };
  const reasoning = resolvedModel.model.reasoning;
  active.harnessModelProfile = {
    provider: resolvedModel.providerName,
    model: typeof resolvedModel.model.id === 'string' ? resolvedModel.model.id : patch.model.trim(),
    reasoningProfile:
      typeof reasoning === 'string' ? reasoning : reasoning === true ? 'enabled' : 'default',
    workflowKind: active.resourceState.chatMode
      ? WorkbenchContractKind.Chat
      : WorkbenchContractKind.GenericWork,
    harnessVersion: HarnessVersion,
  };
  const maxOutputTokens = resolvedModel.maxOutputTokens;
  if (active.resourceState.maxOutputTokens !== maxOutputTokens) {
    active.resourceState.maxOutputTokens = maxOutputTokens;
    await active.piSession.reload();
  }
  console.log('[PiRuntime] Model updated via patchSession:', patch.model);
}
