/**
 * Session continuation for the Pi runtime adapter.
 *
 * Extracted from PiRuntimeAdapter.continueSession/patchSession: drives a
 * follow-up turn on a live Pi session — deciding whether the session can be
 * reused or must be recreated (model/skills/MCP topology/unattended changes
 * restore history from the store), reloading resources, running the workbench
 * run bookkeeping, and dispatching the next prompt. patchSession swaps the
 * model or thinking level of a live session in place.
 */

import { observeWorkbench } from '../../workbenchTask/observe';

import { randomUUID } from 'crypto';

import { classifyCoworkError } from '../../../common/coworkError';
import { normalizeSingleExpertIds } from '../../../shared/cowork/sessionExperts';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { assertCoworkSubmissionContent } from '../../../shared/cowork/submissionContent';
import { HarnessVersion } from '../../../shared/harness';
import { ZhiyuanModelPoolWorkload } from '../../../shared/modelPool/constants';
import { WorkbenchContractKind, WorkbenchRunTrigger } from '../../../shared/workbenchTask';
import { agentResourceDiagnostics } from '../../agentResourceDiagnostics';
import type { CoworkMessage } from '../../coworkStore';
import { captureMemoryPromptForE2e } from '../../memory/memoryPromptE2eCapture';
import { resolveProjectMemoryContextForPiPrompt } from '../../memory/piRuntimeProjectMemoryPrompt';
import { collectImagePathReferences } from './piImageInputFallback';
import { resolvePiModel } from './piMagpiePiModel';
import { resolvePiSessionModel } from './piRuntimeSettingsOverrides';
import { resolveZhiyuanSkillDirs } from './piRuntimeSkillDirs';
import { resolvePiSkillRoots } from './piSkillRoots';
import {
  getPiModules,
  haveSameStringList,
  normalizeSkillIds,
  preparePiPrompt,
  sendPiPrompt,
} from './piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import type { PiContinueOptions, PiSessionPatch } from './piRuntimeTypes';

export async function continuePiRuntimeSession(
  host: PiRuntimeAdapterHost,
  sessionId: string,
  prompt: string,
  options: PiContinueOptions = {},
): Promise<void> {
  assertCoworkSubmissionContent({ prompt, imageAttachments: options.imageAttachments });
  host.evictIdleSessions();
  const explicitExpertIds = normalizeSingleExpertIds(options.expertIds);
  const nextUnattended = options.unattended === true;
  const active = host.activeSessions.get(sessionId);
  if (!active || active.aborted) {
    if (active?.aborted) {
      host.activeSessions.delete(sessionId);
    }
    console.log(
      `[PiRuntime] continueSession: session ${sessionId} not active or was aborted, recreating session`,
    );
    const storedSession = host.getStore()?.getSession(sessionId, 0, { includeArtifacts: false });
    const chatMode =
      options.sessionMode === CoworkSessionMode.Chat ||
      storedSession?.mode === CoworkSessionMode.Chat;
    return await host.startSession(sessionId, prompt, {
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
  const mcpToolTopologyChanged =
    !active.resourceState.chatMode &&
    active.mcpToolManifestGeneration !== host.getMcpToolManifestGeneration();
  const unattendedTopologyChanged = nextUnattended !== active.unattended;
  if (
    (options.modelOverride !== undefined &&
      options.modelOverride !== active.requestedModelOverride) ||
    !haveSameStringList(requestedExpertIds, active.requestedExpertIds) ||
    nextCodemode !== active.codemodeEnabled ||
    unattendedTopologyChanged
  ) {
    host.disposeSessionForRecreation(sessionId, active);
    return await host.startSession(sessionId, prompt, {
      ...options,
      sessionMode: requestedSessionMode,
      systemPrompt: requestedSystemPrompt ?? active.requestedSystemPrompt,
      skillIds: requestedSkillIds,
      expertIds: requestedExpertIds,
      goalMode: nextGoalMode,
      codemode: nextCodemode,
      unattended: nextUnattended,
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
  if (skillsChanged && (active.resourceState.chatMode || cadToolChanged)) {
    host.disposeSessionForRecreation(sessionId, active);
    return await host.startSession(sessionId, prompt, {
      ...options,
      sessionMode: requestedSessionMode,
      systemPrompt: nextSystemPrompt,
      skillIds: requestedSkillIds,
      expertIds: requestedExpertIds,
      goalMode: nextGoalMode,
      codemode: nextCodemode,
      unattended: nextUnattended,
    });
  }

  active.goalMode = nextGoalMode;
  active.planMode = nextPlanMode;

  if (
    promptChanged ||
    skillsChanged ||
    active.pendingSkillReload === true ||
    mcpToolTopologyChanged
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
      active.requestedSystemPrompt = nextSystemPrompt;
      active.requestedSkillIds = requestedSkillIds;
      active.pendingSkillReload = false;
      if (mcpToolTopologyChanged) {
        active.mcpToolManifestGeneration = host.getMcpToolManifestGeneration();
        console.debug('[PiRuntime] reloaded session in-place after MCP tool manifest refresh');
      }
      console.debug('[PiRuntime] reloaded session resources after prompt or skill change');
    } catch (error) {
      active.resourceState.systemPrompt = previousSystemPrompt;
      active.resourceState.skillIds = previousSkillIds;
      active.resourceState.skillRoots = previousSkillRoots;
      active.isRunning = false;
      const message = error instanceof Error ? error.message : String(error);
      host.emit('error', sessionId, classifyCoworkError(message));
      throw error;
    }
  }

  active.workbenchRunId = null;
  observeWorkbench(sessionId, () => {
    const workbenchTaskService = host.getWorkbenchTaskService();
    if (workbenchTaskService && !active.resourceState.chatMode) {
      const workflowKind = WorkbenchContractKind.GenericWork;
      const workbench = workbenchTaskService.beginRun({
        sessionId,
        goal: prompt,
        contract: { kind: workflowKind },
        trigger: WorkbenchRunTrigger.Message,
        preparedRunId: options._workbenchRunId,
        preparedTaskId: options._workbenchTaskId,
      });
      active.workbenchRunId = workbench.run.id;
      active.harnessModelProfile = {
        ...active.harnessModelProfile,
        workflowKind,
      };
      workbenchTaskService.measurement?.recordModelProfile(
        workbench.run.id,
        active.harnessModelProfile,
      );
      workbenchTaskService.updateRunContext(workbench.run.id, {
        model: active.harnessModelProfile.model,
        provider: active.harnessModelProfile.provider,
        reasoningProfile: active.harnessModelProfile.reasoningProfile,
        workspaceRoot: active.workspaceRoot,
        skillIds: requestedSkillIds ?? [],
      });
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
    host.getStore()?.getSession(sessionId, 0, { includeArtifacts: false })?.experts ?? []
  )
    .filter(expert => active.requestedExpertIds.includes(expert.expertId))
    .map(expert => ({
      expertId: expert.expertId,
      expertName: expert.expertName,
      presetId: expert.packageId,
    }));

  // Emit user message (persisted to SQLite, same as startSession).
  if (!options._skipUserMessage) {
    const storedImages = host.persistImageAttachments(sessionId, options.imageAttachments);
    // Same rule as startSession: the chips on this user turn are the skills the
    // user attached to this input, not the turn's execution set.
    const attachedSkillIds = options.attachedSkillIds;
    const userMsg = {
      id: randomUUID(),
      type: 'user',
      content: prompt,
      timestamp: Date.now(),
      metadata:
        attachedSkillIds?.length ||
        storedImages?.length ||
        options.fileAttachments?.length ||
        active.turnExperts.length
          ? {
              ...(attachedSkillIds?.length ? { skillIds: attachedSkillIds } : {}),
              ...(storedImages?.length ? { imageAttachments: storedImages } : {}),
              ...(options.fileAttachments?.length
                ? { fileAttachments: options.fileAttachments }
                : {}),
              ...(active.turnExperts.length ? { experts: active.turnExperts } : {}),
            }
          : undefined,
    } as CoworkMessage;
    const store = host.getStore();
    const persisted = store ? store.addMessage(sessionId, userMsg) : userMsg;
    host.emit('message', sessionId, persisted);
  }

  try {
    const projectMemoryContext = await resolveProjectMemoryContextForPiPrompt({
      chatMode: active.resourceState.chatMode,
      memoryInjectionDedup: host.memoryInjectionDedup,
      projectMemoryService: host.getProjectMemoryService(),
      workspaceRoot: active.workspaceRoot,
      sessionId,
      userPrompt: prompt,
      signal: active.abortController.signal,
    });
    active.abortController.signal.throwIfAborted();
    active.pendingTurnMemoryContext = projectMemoryContext;
    captureMemoryPromptForE2e({
      sessionId,
      userPrompt: prompt,
      memoryContext: projectMemoryContext,
      initialPrompt: prompt,
    });
    const continuedImagePrompt = preparePiPrompt(
      prompt,
      options.imageAttachments,
      host.recovery.imageInputVerdictForActive(active),
      host.getOcrCommandFor(),
      collectImagePathReferences(options.fileAttachments),
    );
    host.recovery.reportOmittedImages(sessionId, continuedImagePrompt);
    await sendPiPrompt(active.piSession, continuedImagePrompt);
  } catch (error) {
    host.memoryInjectionDedup.reset(sessionId);
    active.isRunning = false;
    if (active.abortController.signal.aborted) {
      host.emit('sessionStopped', sessionId);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    host.emit('error', sessionId, classifyCoworkError(message));
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

  try {
    const pi = await getPiModules();
    const resolvedModel = await resolvePiModel(pi, patch.model, active.modelRuntime, {
      conversationId: sessionId,
      workload: active.resourceState.chatMode
        ? ZhiyuanModelPoolWorkload.Chat
        : ZhiyuanModelPoolWorkload.Work,
    });
    const model = resolvePiSessionModel(resolvedModel.model, active.resourceState.chatMode);
    await active.piSession.setModel(model);
    active.model = model;
    active.requestedModelOverride = patch.model;
    active.modelRuntime = resolvedModel.modelRuntime;
    active.modelRequestOptions = resolvedModel.requestOptions;
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
  } catch (err) {
    console.warn('[PiRuntime] Failed to update model via patchSession:', err);
  }
}
