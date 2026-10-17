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
import { restorePiConversationPrompt, summarizePiHistoryFromStore } from './piConversationContext';
import { PiAgentLoopMode } from './piAgentLoop';
import { PiPlanModePrompt } from './piPlanTool';
import { resolvePiTurnWorkflowSkills } from './piTurnWorkflow';
import {
  finalizePiPromptWithProjectMemory,
  resolveProjectMemoryContextForPiPrompt,
} from '../../memory/piRuntimeProjectMemoryPrompt';
import { PiWriteTokenLimitRecovery } from './piWriteTokenLimit';
import { collectImagePathReferences } from './piImageInputFallback';
import { waitForPiRetryCancellation } from './piRetryCancellation';
import { resolvePiModel } from './piMagpiePiModel';
import {
  applyPiCompactionOverrides,
  applyPiShellOverride,
  resolveConversationHistoryCharLimit,
  resolvePiSessionModel,
} from './piRuntimeSettingsOverrides';
import { createPiWorkbenchContract } from './piRuntimeWorkbenchContract';
import {
  getPiModules,
  haveSameStringList,
  normalizeSkillIds,
  preparePiPrompt,
  sendPiPrompt,
  PiChatRuntimeLimit,
  type PiResourceState,
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
  const retryCancellation = active && waitForPiRetryCancellation(active.piSession);
  if (retryCancellation) await retryCancellation;
  if (active?.completionPending) await active.completionPending;
  if (!active || active.aborted) {
    if (active?.aborted) {
      host.activeSessions.delete(sessionId);
    }
    console.log(
      `[PiRuntime] continueSession: session ${sessionId} not active or was aborted, restoring context via prompt`,
    );
    const historyLoadStartedAt = Date.now();
    // Read the transcript tail in pages and stop at the character budget
    // instead of materializing the full history; the injected prompt is
    // identical because the selection rule only ever walks newest-first.
    // Metadata still comes from a zero-message read for mode/experts/cwd.
    const storedSession = host.getStore()?.getSession(sessionId, 0, { includeArtifacts: false });
    const chatMode =
      options.sessionMode === CoworkSessionMode.Chat ||
      storedSession?.mode === CoworkSessionMode.Chat;
    const piPrompt = restorePiConversationPrompt(host.getStore(), sessionId, prompt, {
      maxChars: resolveConversationHistoryCharLimit(undefined, undefined, chatMode),
      ocrCommandFor: host.getOcrCommandFor(),
    });
    agentResourceDiagnostics.recordPiHistoryRestored(sessionId, {
      source: 'continue',
      ...summarizePiHistoryFromStore(host.getStore(), sessionId),
      promptChars: piPrompt.length,
      restoreMs: Date.now() - historyLoadStartedAt,
    });
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
    options.skillIds === undefined ? active.requestedSkillIds : normalizeSkillIds(options.skillIds);
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
    active.mcpToolManifestGeneration !== host.getMcpToolManifestGeneration();
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
    const piPrompt = restorePiConversationPrompt(host.getStore(), sessionId, prompt, {
      maxChars: resolveConversationHistoryCharLimit(
        typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
        typeof active.model.maxTokens === 'number' ? active.model.maxTokens : undefined,
        active.resourceState.chatMode,
      ),
      ocrCommandFor: host.getOcrCommandFor(),
    });
    agentResourceDiagnostics.recordPiHistoryRestored(sessionId, {
      source: 'recreate',
      ...summarizePiHistoryFromStore(host.getStore(), sessionId),
      promptChars: piPrompt.length,
      restoreMs: Date.now() - historyLoadStartedAt,
    });
    host.disposeSessionForRecreation(sessionId, active);
    return await host.startSession(sessionId, prompt, {
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
    const piPrompt = restorePiConversationPrompt(host.getStore(), sessionId, prompt, {
      maxChars: resolveConversationHistoryCharLimit(
        typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
        typeof active.model.maxTokens === 'number' ? active.model.maxTokens : undefined,
        active.resourceState.chatMode,
      ),
      ocrCommandFor: host.getOcrCommandFor(),
    });
    agentResourceDiagnostics.recordPiHistoryRestored(sessionId, {
      source: 'skills-change',
      ...summarizePiHistoryFromStore(host.getStore(), sessionId),
      promptChars: piPrompt.length,
      restoreMs: Date.now() - historyLoadStartedAt,
    });
    host.disposeSessionForRecreation(sessionId, active);
    return await host.startSession(sessionId, prompt, {
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
      applyPiShellOverride(active.settingsManager);
      applyPiCompactionOverrides(
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
      host.emit('error', sessionId, classifyCoworkError(message));
      throw error;
    }
  }

  const workbenchTaskService = host.getWorkbenchTaskService();
  if (workbenchTaskService && !active.resourceState.chatMode) {
    const workbenchContract = createPiWorkbenchContract(requestedSessionMode, requestedSkillIds);
    const workbench = workbenchTaskService.beginRun({
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
  active.writeTokenLimitRecovery.reset();
  active.pendingError = null;
  active.turnFailed = false;
  active.errorSurfaced = false;
  active.retryNoticeEmitted = false;
  active.retryAttempts = 0;
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
    } as CoworkMessage;
    const store = host.getStore();
    const persisted = store ? store.addMessage(sessionId, userMsg) : userMsg;
    host.emit('message', sessionId, persisted);
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
      memoryInjectionDedup: host.memoryInjectionDedup,
      projectMemoryService: host.getProjectMemoryService(),
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
      workbenchTaskService: host.getWorkbenchTaskService(),
    });
    const continuedImagePrompt = preparePiPrompt(
      nextPrompt,
      options.imageAttachments,
      host.recovery.imageInputVerdictForActive(active),
      host.getOcrCommandFor(),
      collectImagePathReferences(options.fileAttachments),
    );
    host.recovery.recordImagePrompt(sessionId, active, nextPrompt, continuedImagePrompt);
    await sendPiPrompt(active.piSession, continuedImagePrompt, options._streamingBehavior);
    await active.eventProjection?.drain();
    await active.completionPending;
  } catch (error) {
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
      workload:
        active.workbenchContract.kind === WorkbenchContractKind.Chat
          ? ZhiyuanModelPoolWorkload.Chat
          : ZhiyuanModelPoolWorkload.Work,
    });
    const model = resolvePiSessionModel(resolvedModel.model, active.resourceState.chatMode);
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
      applyPiShellOverride(active.settingsManager);
      applyPiCompactionOverrides(
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
