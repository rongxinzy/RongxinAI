import { observeWorkbench } from '../workbenchTask/observe';
import path from 'path';

import { app } from 'electron';

import { diagnoseCodingMcp } from './codingMcpDiagnostics';
import {
  getAgentManager,
  getCoworkStore,
  getMcpStore,
  getSkillManager,
  getStore,
} from './runtimeServices';
import { getWorkbenchTaskService } from './sessionServices';
import { resolveDefaultAgentModelRef } from './defaultAgentModel';
import { resolveSessionExpertSnapshots } from './sessionExperts';
import { lifecycleRuntime } from './lifecycleRuntimeState';
import { t } from '../i18n';
import {
  WorkbenchApprovalMode,
  WorkbenchContractKind,
  WorkbenchRunTrigger,
} from '../../shared/workbenchTask';
import { CoworkSessionExpertSource } from '../../shared/cowork/sessionExperts';
import { CodingAgentProfileRepository } from '../codingAgent/codingAgentProfileRepository';
import { CodingAgentRegistry } from '../codingAgent/codingAgentRegistry';
import type { CodingRoomRepository } from '../codingAgent/codingRoomRepository';
import { CodingRoomService } from '../codingAgent/codingRoomService';
import { resolveAcpAdapterRoot } from '../codingAgent/acp/adapterRoot';
import { resolveCodingExpertSelection } from '../codingAgent/builtinCodingExpertSelection';
import { GitWorktreeService } from '../codingAgent/gitWorktreeService';
import { bindCodingRoomPiEvents } from '../codingAgent/piCodingEventAdapter';
import type { MagpieModelService } from '../magpie/modelService';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import type { PiThinkingLevel } from '../libs/agentEngine/piRuntimeTypes';

export function createCodingRoomRuntime() {
  let codingCommandCatalogGeneration = 0;
  const bumpCommandCatalog = () => {
    codingCommandCatalogGeneration += 1;
  };
  let codingRoom: { service: CodingRoomService; detach: () => void } | undefined;

  function start(
    models: MagpieModelService,
    runtime: PiRuntimeAdapter,
    repository: CodingRoomRepository,
  ): CodingRoomService {
    if (codingRoom) return codingRoom.service;
    const worktrees = new GitWorktreeService();
    const previewWorktreeDiff = (workspaceRoot: string) =>
      worktrees.getWorktreeDiffPreview(workspaceRoot);
    const service = new CodingRoomService(
      repository,
      new CodingAgentRegistry(
        new CodingAgentProfileRepository(getStore().getDatabase()),
        () => {
          const enabled = getStore().get<boolean>('magpie_service_enabled') === true;
          return enabled && Boolean(resolveDefaultAgentModelRef());
        },
        app.isPackaged
          ? path.join(process.resourcesPath, 'acp', 'registry.json')
          : path.join(process.cwd(), 'resources', 'acp', 'registry.json'),
        resolveAcpAdapterRoot({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
        }),
      ),
      {
        startBuiltinSession: async ({
          sessionId,
          workspaceRoot,
          prompt,
          modelOverride,
          thinkingLevel,
          permissionMode,
          goalMode,
          planMode,
          skillIds,
          expertIds,
        }) => {
          const approvalMode =
            permissionMode === WorkbenchApprovalMode.Auto ||
            permissionMode === WorkbenchApprovalMode.AllowAll
              ? permissionMode
              : WorkbenchApprovalMode.Ask;
          const expertSelection = expertIds
            ? await resolveCodingExpertSelection({
                expertIds,
                resolveSnapshots: resolveSessionExpertSnapshots,
              })
            : null;
          if (lifecycleRuntime.isQuitting) throw new Error('The application is shutting down.');
          const coworkStoreInstance = getCoworkStore();
          if (coworkStoreInstance.getPiHistoryKey(sessionId) === undefined) {
            coworkStoreInstance.createSession(
              t('coworkDefaultSessionTitle'),
              workspaceRoot,
              '',
              'local',
              [],
              'main',
              '',
              'work',
              sessionId,
            );
          }
          // Resolving comes first: a stale expert id throws. Pi's agent_start
          // event is the single source of truth for the running state.
          await runtime.continueSession(sessionId, prompt, {
            workspaceRoot,
            sessionMode: 'work',
            _skipUserMessage: true,
            approvalMode,
            planTool: true,
            codingElicitation: true,
            ...(modelOverride ? { modelOverride } : {}),
            ...(thinkingLevel ? { thinkingLevel: thinkingLevel as PiThinkingLevel } : {}),
            ...(goalMode ? { goalMode: true } : {}),
            ...(planMode ? { planMode: true } : {}),
            ...(skillIds ? { skillIds } : {}),
            ...(expertSelection
              ? { expertIds: expertSelection.expertIds, systemPrompt: expertSelection.systemPrompt }
              : {}),
          });
        },
        setBuiltinApprovalMode: (sessionId, mode) =>
          runtime.setApprovalModeForSession(sessionId, mode),
        patchBuiltinSession: (sessionId, patch) =>
          runtime.patchSession(sessionId, {
            model: patch.model,
            thinkingLevel: patch.thinkingLevel as PiThinkingLevel | null | undefined,
          }),
        cancelBuiltinSession: async sessionId => runtime.stopSession(sessionId),
        commandCatalogGeneration: () => codingCommandCatalogGeneration,
        listCommandChoices: async () => ({
          skills: (await getSkillManager().listSkills())
            .filter(skill => skill.enabled)
            .map(skill => ({
              id: skill.id,
              name: skill.displayName?.trim() || skill.name,
              description: skill.displayDescription?.trim() || skill.description,
            })),
          experts: getAgentManager()
            .listAgents()
            .filter(
              agent =>
                agent.source === CoworkSessionExpertSource.Package ||
                agent.source === CoworkSessionExpertSource.Member,
            )
            .map(agent => ({
              id: agent.id,
              name: agent.name,
              description: agent.description,
            })),
          mcpServers: getMcpStore()
            .listServers()
            // `/mcp <name>` carries the name as a single token, so a configured
            // name containing whitespace cannot be addressed from the composer.
            // Disabled servers stay listed: the scoped report names them and
            // reports that they are off, which is usually the answer people want.
            .filter(server => !/\s/u.test(server.name))
            .map(server => ({
              id: server.name,
              name: server.name,
              description: server.description,
            })),
        }),
        respondBuiltinElicitation: (requestId, answer) =>
          runtime.respondToCodingElicitation(requestId, answer),
        cancelBuiltinElicitation: (requestId, reason) =>
          runtime.cancelCodingElicitation(requestId, reason),
        compactBuiltinSession: sessionId => runtime.compactSession(sessionId),
        describeBuiltinMcp: target => diagnoseCodingMcp(getMcpStore().listServers(), target),
        enqueueBuiltinControlAction: (sessionId, action) =>
          runtime.enqueueControlAction(sessionId, action),
        isBuiltinSessionRunning: sessionId => runtime.isSessionRunning(sessionId),
        isBuiltinSessionActive: sessionId => runtime.isSessionActive(sessionId),
        enqueueBuiltinMessage: (sessionId, prompt) =>
          runtime.enqueuePendingMessage(sessionId, prompt),
        steerBuiltinMessage: (sessionId, prompt) => runtime.steerInput(sessionId, prompt),
        getBuiltinWorkbenchLink: sessionId =>
          observeWorkbench(sessionId, () =>
            getWorkbenchTaskService().repository.getLatestRunLinkForSession(sessionId),
          ) ?? null,
        beginExternalWorkbenchRun: ({ sessionId, goal, workspaceRoot }) => {
          return (
            observeWorkbench(sessionId, () => {
              const workbench = getWorkbenchTaskService().beginRun(
                {
                  sessionId,
                  goal,
                  contract: {
                    kind: WorkbenchContractKind.GenericWork,
                    metadata: { codingAgent: true },
                  },
                  trigger: WorkbenchRunTrigger.Message,
                },
                {
                  context: {
                    model: 'external-agent',
                    provider: 'external-agent',
                    reasoningProfile: 'external',
                    workspaceRoot,
                    skillIds: [],
                  },
                },
              );
              return { taskId: workbench.task.id, runId: workbench.run.id };
            }) ?? null
          );
        },
        completeExternalWorkbenchRun: async ({
          sessionId,
          laneId,
          runId,
          workspaceRoot,
          finalAnswer,
        }) => {
          observeWorkbench(sessionId, () => {
            getWorkbenchTaskService().settleObservedRun({
              sessionId,
              artifactScopeId: laneId,
              runId,
              workspaceRoot,
              finalAnswer,
            });
          });
        },
        failExternalWorkbenchRun: ({ sessionId, runId, error }) => {
          observeWorkbench(sessionId, () =>
            getWorkbenchTaskService().failRun(sessionId, { message: error }, runId),
          );
        },
        cancelExternalWorkbenchRun: ({ sessionId, runId }) => {
          observeWorkbench(sessionId, () => getWorkbenchTaskService().cancelRun(sessionId, runId));
        },
        respondBuiltinPermission: (requestId, approved) =>
          runtime.respondToPermission(
            requestId,
            approved
              ? { behavior: 'allow' }
              : { behavior: 'deny', message: 'The user denied this coding permission.' },
          ),
        validateBuiltinModel: async () => {
          await models.resolve(undefined, { work: true });
        },
        getWorkspaceBaseline: async workspaceRoot => {
          try {
            return await GitWorktreeService.getBaseline(workspaceRoot);
          } catch {
            return null;
          }
        },
        getWorkspaceDiff: previewWorktreeDiff,
        applyWorkspacePatch: ({ workspaceRoot, patch }) =>
          worktrees.applyPatch(workspaceRoot, patch),
        getIsolatedWorkspaceDiff: previewWorktreeDiff,
        applyIsolatedWorkspaceDiff: ({ workspaceRoot, isolatedWorkspaceRoot }) =>
          worktrees.applyWorktreeDiff({
            repositoryRoot: workspaceRoot,
            worktreeRoot: isolatedWorkspaceRoot,
          }),
      },
      {
        // The bundled Claude ACP adapter writes its own full exception details
        // here. This is intentionally app-owned and never includes credentials.
        CLAUDE_AGENT_LOGS: path.join(app.getPath('userData'), 'acp-logs', 'claude'),
        CLAUDE_CODE_DIAGNOSTICS_FILE: path.join(
          app.getPath('userData'),
          'acp-logs',
          'claude',
          'sdk-diagnostics.jsonl',
        ),
      },
    );
    service.registry.hydrate();
    const stopPiEvents = bindCodingRoomPiEvents(runtime, service);
    const stopSkillChanges = getSkillManager().onSkillsChanged(bumpCommandCatalog);
    codingRoom = {
      service,
      detach: () => {
        stopPiEvents();
        stopSkillChanges();
      },
    };
    return service;
  }

  return {
    start,
    bumpCommandCatalog,
    stop() {
      codingRoom?.detach();
      return codingRoom?.service.shutdown();
    },
  };
}

export type CodingRoomRuntime = ReturnType<typeof createCodingRoomRuntime>;
