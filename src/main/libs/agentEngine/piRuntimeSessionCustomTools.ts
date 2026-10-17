/**
 * Custom tool composition for a new Pi session.
 *
 * Extracted from PiRuntimeAdapter.startSession: assembles the per-session
 * custom tool set (web search, plan, elicitations, memory, history, scheduled
 * tasks, document/python/artifact tools, MCP gateway, research/shortcut
 * workflow state, skill runtime tools, subagent, agent loop) together with
 * the workflow controllers and loop prompt the turn needs.
 */

import path from 'path';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { type HarnessActivationEvent } from '../../../shared/harness';
import {
  WorkbenchApprovalMode,
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactVerificationStatus,
} from '../../../shared/workbenchTask';
import { buildPiConversationHistoryTool } from '../../conversationHistory/piTool';
import { buildDeclareArtifactTool } from '../../declareArtifact/tool';
import { buildPiProjectMemoryTool } from '../../memory/piMemoryTool';
import { getPythonRuntimeService } from '../../pythonRuntime/host';
import { getSkillsRoot } from '../coworkUtil';
import { isRasterPreviewDecodable, renderOfficePreview } from '../officePreviewRenderer';
import { createPiAskUserQuestionTool } from './piAskUserQuestion';
import { createPiCodingElicitationTool } from './piCodingElicitation';
import { createPiPlanTool } from './piPlanTool';
import { isAcademicResearchSkillSet, PiResearchRunController } from './piResearchRun';
import { buildPiResearchStateTool } from './piResearchStateTool';
import { PiShortcutWorkflowController, ShortcutWorkflowKind } from './piShortcutWorkflow';
import { buildPiShortcutWorkflowStateTool } from './piShortcutWorkflowStateTool';
import { buildPiSubagentTool } from './piSubagentTool';
import { buildPiSkillScriptTool } from './piSkillScriptTool';
import { resolvePiSkillRoots } from './piSkillRoots';
import { buildPiCadViewerTool } from './piCadViewerTool';
import { buildPiSkillRuntimeCapabilitiesTool } from './piSkillRuntimeCapabilitiesTool';
import { buildPiDocumentReaderTool } from './piDocumentReaderTool';
import { buildPiPythonTools } from './piPythonTools';
import { buildPiScheduledTaskTool } from './piScheduledTaskTool';
import { shouldExposeAskUserQuestionTool } from './piUnattendedPolicy';
import { createPiWorkLoop } from './piWorkLoop';
import { buildPiWebSearchTool } from './piWebSearchTool';
import { buildPiMcpProxyTool, createPiRuntimeResourceLoader } from './piRuntimeResourceLoader';
import { resolveZhiyuanSkillDirs } from './piRuntimeSkillDirs';
import type { PiModules, PiResolvedModel, PiResourceState } from './piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import type { PiStartOptions } from './piRuntimeTypes';

interface PiSessionCustomToolsParams {
  pi: PiModules;
  sessionId: string;
  prompt: string;
  options: PiStartOptions;
  resourceState: PiResourceState;
  resolvedModel: PiResolvedModel;
  workspaceRoot: string;
  workbenchRunId: string | null;
  expertIds: string[];
  workflowSkillIds: string[] | undefined;
  shortcutKindForContract: ShortcutWorkflowKind | null;
  mcpNativeBridge: boolean;
  abortSignal: AbortSignal;
  recordActivation: (event: HarnessActivationEvent) => void;
}

export function buildPiSessionCustomTools(
  host: PiRuntimeAdapterHost,
  params: PiSessionCustomToolsParams,
): {
  customTools: Record<string, unknown>[];
  researchRun: PiResearchRunController | null;
  shortcutWorkflow: PiShortcutWorkflowController | null;
  agentLoop: ReturnType<typeof createPiWorkLoop>['controller'];
  workLoopPrompt: string;
  shouldRunGoalLoop: boolean;
} {
  const {
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
    abortSignal,
    recordActivation,
  } = params;
  // Build custom tools: MCP proxy + optional subagent for Team Leads.
  // Each call creates a distinct tool instance for this Pi session, so its
  // sequential execution mode cannot block another session.
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
        onDeclare: host.getWorkbenchTaskService()
          ? async artifact => {
              const runId = host.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId;
              if (!runId) throw new Error('No active workbench run is available.');
              await host.getWorkbenchTaskService()?.registerArtifact({
                sessionId,
                runId,
                workspaceRoot,
                signal: abortSignal,
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
    const mcpProxyTool = mcpNativeBridge ? null : buildPiMcpProxyTool(host.getMcpServerManager());
    if (mcpProxyTool) {
      customTools.push(mcpProxyTool);
    }
  }

  // Academic research is a controlled workflow, not a prompt-only label.
  // It owns durable state and completion gates for the lifetime of this
  // session (and reloads the same state directory after a session restart).
  const researchRun =
    options.sessionMode !== CoworkSessionMode.Chat && isAcademicResearchSkillSet(workflowSkillIds)
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

  return {
    customTools,
    researchRun,
    shortcutWorkflow,
    agentLoop,
    workLoopPrompt,
    shouldRunGoalLoop,
  };
}
