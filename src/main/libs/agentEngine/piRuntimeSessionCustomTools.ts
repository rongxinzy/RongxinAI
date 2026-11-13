/**
 * Custom tool composition for a new Pi session.
 *
 * Extracted from PiRuntimeAdapter.startSession: assembles the per-session
 * custom tool set (web search, plan, elicitations, memory, history, scheduled
 * tasks, document/python/artifact tools, MCP gateway, skill runtime tools,
 * and cancellable subagents). Pi owns execution and completion.
 */

import path from 'path';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { type HarnessActivationEvent } from '../../../shared/harness';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { buildPiConversationHistoryTool } from '../../conversationHistory/piTool';
import { buildPiProjectMemoryTool } from '../../memory/piMemoryTool';
import { getPythonRuntimeService } from '../../pythonRuntime/host';
import { getSkillsRoot } from '../coworkUtil';
import { createPiAskUserQuestionTool } from './piAskUserQuestion';
import { createPiCodingElicitationTool } from './piCodingElicitation';
import { createPiPlanTool } from './piPlanTool';
import { buildPiSubagentTool } from './piSubagentTool';
import { buildPiSkillScriptTool } from './piSkillScriptTool';
import { resolvePiSkillRoots } from './piSkillRoots';
import { buildPiCadViewerTool } from './piCadViewerTool';
import { buildPiSkillRuntimeCapabilitiesTool } from './piSkillRuntimeCapabilitiesTool';
import { buildPiDocumentReaderTool } from './piDocumentReaderTool';
import { buildSessionSummaryTool } from '../../sessionSummary/tool';
import { HarnessActivationType } from '../../../shared/harness/constants';
import { buildPiPythonTools } from './piPythonTools';
import { buildPiScheduledTaskTool } from './piScheduledTaskTool';
import { shouldExposeAskUserQuestionTool } from './piUnattendedPolicy';
import { buildPiWebSearchTool } from './piWebSearchTool';
import { createPiRuntimeResourceLoader } from './piRuntimeResourceLoader';
import { resolveZhiyuanSkillDirs } from './piRuntimeSkillDirs';
import type { PiModules, PiResolvedModel, PiResourceState } from './piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import type { PiStartOptions } from './piRuntimeTypes';

interface PiSessionCustomToolsParams {
  pi: PiModules;
  sessionId: string;
  options: PiStartOptions;
  resourceState: PiResourceState;
  resolvedModel: PiResolvedModel;
  workspaceRoot: string;
  workbenchRunId: string | null;
  expertIds: string[];
  abortSignal: AbortSignal;
  recordActivation: (event: HarnessActivationEvent) => void;
}

export function buildPiSessionCustomTools(
  host: PiRuntimeAdapterHost,
  params: PiSessionCustomToolsParams,
): {
  customTools: Record<string, unknown>[];
} {
  const {
    pi,
    sessionId,
    options,
    resourceState,
    resolvedModel,
    workspaceRoot,
    workbenchRunId,
    expertIds,
    abortSignal,
    recordActivation,
  } = params;
  // Build custom tools for this Pi session.
  // Each call creates a distinct tool instance so sequential execution mode cannot block another session.
  const customTools: Record<string, unknown>[] = [];
  if (resourceState.chatMode) customTools.push(buildPiWebSearchTool());

  if (options.planTool === true || options.planMode === true) {
    // The plan tool never touches the workspace: it publishes the structured
    // plan the coding lane renders. It stays registered for the session so a
    // plan turn can reuse a live transcript instead of rebuilding the session.
    customTools.push(createPiPlanTool(entries => host.emit('plan', sessionId, { entries })));
  }

  if (options.codingElicitation === true) {
    // Coding-only free-text pause point: the agent asks, the lane waits.
    customTools.push(
      createPiCodingElicitationTool((toolCallId, input, signal) =>
        host.recovery.requestCodingElicitation(sessionId, toolCallId, input, signal),
      ),
    );
  }

  if (shouldExposeAskUserQuestionTool(resourceState.unattended)) {
    customTools.push(
      createPiAskUserQuestionTool((toolCallId, input, signal) =>
        host.recovery.requestAskUserQuestion(sessionId, toolCallId, input, signal),
      ),
    );
  }
  if (!resourceState.chatMode)
    customTools.push(
      buildSessionSummaryTool({
        getProjectMemoryService: () => {
          const service = host.getProjectMemoryService();
          if (!service) throw new Error('Project memory service is unavailable.');
          return service;
        },
        sessionId,
        workingDirectory: workspaceRoot,
        runId: workbenchRunId,
        getExecutionIdentity: toolCallId => {
          const active = host.activeSessions.get(sessionId);
          return {
            runId: active?.workbenchRunId ?? workbenchRunId,
            turnId: active?.assistantMessageId ?? toolCallId,
          };
        },
        onOutcome: (outcome, reason) => {
          const active = host.activeSessions.get(sessionId);
          if (!active) return;
          if (outcome === 'written') active.summaryCheckpointWritten = true;
          if (outcome === 'skipped') active.summaryCheckpointSkipped = reason ?? true;
          active.summaryCheckpointWorkVersion = active.artifactRecorder?.recordedWorkVersion() ?? 0;
          recordActivation({
            activation:
              outcome === 'written'
                ? HarnessActivationType.SummaryWritten
                : HarnessActivationType.SummarySkipped,
            mechanism: 'session_checkpoint',
            ...(reason ? { evidence: { reason } } : {}),
          });
        },
      }),
    );
  const projectMemoryService = host.getProjectMemoryService();
  if (!resourceState.chatMode && projectMemoryService) {
    customTools.push(
      buildPiProjectMemoryTool({
        service: projectMemoryService,
        sessionId,
        workingDirectory: workspaceRoot,
        getMessages: () => host.getStore()?.getSession(sessionId, 32)?.messages ?? [],
        complete: async messages => {
          const complete = host.getSessionMemoryCompletion(sessionId);
          if (!complete) throw new Error('The session model is unavailable for memory extraction.');
          return await complete(messages);
        },
      }),
    );
  }
  const conversationHistoryService = host.getConversationHistoryService();
  if (!resourceState.chatMode && conversationHistoryService) {
    customTools.push(
      buildPiConversationHistoryTool({
        service: conversationHistoryService,
        workingDirectory: workspaceRoot,
        sessionId,
      }),
    );
  }
  const scheduledTaskService = host.getScheduledTaskService();
  if (scheduledTaskService && options.sessionMode === CoworkSessionMode.Work) {
    customTools.push(
      buildPiScheduledTaskTool({
        service: scheduledTaskService,
        workspaceId:
          host.getStore()?.getSession(sessionId, 0, { includeArtifacts: false })?.workspaceId ??
          null,
        sessionKey: sessionId,
        defaultDelivery: host.getScheduledTaskDeliveryForSession?.(sessionId) ?? null,
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
  }

  if (options.sessionMode === CoworkSessionMode.Work && resourceState.fileToolsEnabled) {
    customTools.push(buildPiSkillRuntimeCapabilitiesTool());
    customTools.push(
      buildPiSkillScriptTool({
        workspaceRoot,
        allowedSkillIds: resourceState.skillIds ?? [],
        skillRoots: resourceState.skillRoots,
        getSkillSelection: () => ({
          skillIds: resourceState.skillIds,
          skillRoots: resourceState.skillRoots,
        }),
      }),
    );
    const cadSkillRoot = resourceState.skillRoots['text-to-cad'];
    if (cadSkillRoot) {
      customTools.push(
        buildPiCadViewerTool({
          workspaceRoot,
          skillRoot: cadSkillRoot,
          service: host.cadViewerService,
        }),
      );
    }
  }

  // Subagent tool: registered for every cowork session. When the session
  // agent is a Team Lead from a package, its presetId additionally exposes
  // the team member agents alongside the built-in profiles.
  let subagentPresetId: string | undefined;
  const store = host.getStore();
  if (!resourceState.chatMode && store) {
    const candidateAgentIds = expertIds.length
      ? expertIds
      : options.agentId
        ? [options.agentId]
        : [];
    const leadAgent = candidateAgentIds
      .map(agentId => store?.getAgent(agentId))
      .find(
        candidate => candidate?.source === CoworkSessionExpertSource.Package && candidate.presetId,
      );
    subagentPresetId = leadAgent?.presetId;
  }
  const subagentTool = resourceState.chatMode
    ? null
    : buildPiSubagentTool({
        getPiAgentsDir: () => host.getPiAgentsDir(),
        presetId: subagentPresetId,
        loadBundledMembers: subagentPresetId
          ? presetId =>
              host.resolveBundledMemberProfiles(presetId)?.map(member => ({
                ...member,
                source: 'member' as const,
              })) ?? null
          : undefined,
        resolvedModel,
        getResolvedModel: () => {
          const active = host.activeSessions.get(sessionId);
          return active
            ? {
                model: active.model,
                modelRuntime: active.modelRuntime,
                maxOutputTokens: active.resourceState.maxOutputTokens,
              }
            : resolvedModel;
        },
        signal: abortSignal,
        workspaceRoot,
        webSearchSkillPath: path.join(getSkillsRoot(), 'web-search'),
        createPiResourceLoader: (
          cwd,
          systemPrompt,
          maxOutputTokens,
          skillIds,
          extensionFactories,
        ) =>
          createPiRuntimeResourceLoader(
            host,
            pi,
            cwd,
            {
              systemPrompt,
              skillIds,
              maxOutputTokens,
              fileToolsEnabled: true,
              unattended: resourceState.unattended,
              chatMode: resourceState.chatMode,
              nativeToolsOnly: true,
              expertSkillDirs: [],
              skillRoots: resolvePiSkillRoots(skillIds, resolveZhiyuanSkillDirs(), []),
            },
            {
              sessionId,
              getRunId: () => host.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId,
              getApprovalMode: () =>
                host.activeSessions.get(sessionId)?.approvalMode ??
                options.approvalMode ??
                WorkbenchApprovalMode.Ask,
            },
            extensionFactories,
          ),
      });
  if (subagentTool) {
    customTools.push(subagentTool);
  }

  return { customTools };
}
