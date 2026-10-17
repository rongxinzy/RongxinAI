import path from 'path';

import { app, BrowserWindow } from 'electron';

import { rt } from './runtimeState';
import {
  getAgentManager,
  getCoworkStore,
  getMcpStore,
  getSkillManager,
  getStore,
} from './runtimeServices';
import { getPiRuntimeAdapter, getWorkbenchTaskService } from './sessionServices';
import { resolveSessionExpertSnapshots } from './sessionExperts';
import { t } from '../i18n';
import {
  WorkbenchApprovalMode,
  WorkbenchContractKind,
  WorkbenchRunTrigger,
} from '../../shared/workbenchTask';
import { CoworkSessionExpertSource } from '../../shared/cowork/sessionExperts';
import { RuntimeNoticeIpc } from '../../shared/ipc/channels';
import type { RuntimeRetryNotice } from '../../common/runtimeNotice';
import type { CoworkToolActivityEvent } from '../../shared/cowork/toolActivity';
import { CoworkInterruptionCause } from '../../shared/cowork/interruption';
import { CodingEventKind, CodingStreamUpdateMode } from '../../shared/codingAgent';
import { CodingAgentProfileRepository } from '../codingAgent/codingAgentProfileRepository';
import { CodingAgentRegistry } from '../codingAgent/codingAgentRegistry';
import { CodingRoomRepository } from '../codingAgent/codingRoomRepository';
import { CodingRoomService } from '../codingAgent/codingRoomService';
import { resolveAcpAdapterRoot } from '../codingAgent/acp/adapterRoot';
import { resolveCodingExpertSelection } from '../codingAgent/builtinCodingExpertSelection';
import { GitWorktreeService } from '../codingAgent/gitWorktreeService';
import { normalizePiMessage, normalizePiToolActivity } from '../codingAgent/piCodingEventAdapter';
import { probeCoworkModelReadiness } from '../libs/coworkUtil';
import type { PiThinkingLevel } from '../libs/agentEngine/piRuntimeTypes';

let codingCommandCatalogGeneration = 0;
export const bumpCodingCommandCatalog = (): void => {
  codingCommandCatalogGeneration += 1;
};

let codingCommandCatalogWatchInstalled = false;
const ensureCodingCommandCatalogWatch = (): void => {
  if (codingCommandCatalogWatchInstalled) return;
  codingCommandCatalogWatchInstalled = true;
  // Skills are watched on disk, so a skill dropped into the skills folder also
  // reaches open lanes through this notification.
  getSkillManager().onSkillsChanged(bumpCodingCommandCatalog);
};

export const getCodingRoomService = (): CodingRoomService => {
  ensureCodingCommandCatalogWatch();
  if (!rt.codingRoomService) {
    const runtime = getPiRuntimeAdapter();
    rt.codingRoomService = new CodingRoomService(
      new CodingRoomRepository(getStore().getDatabase()),
      new CodingAgentRegistry(
        new CodingAgentProfileRepository(getStore().getDatabase()),
        () => {
          const enabled = getStore().get<boolean>('magpie_service_enabled') === true;
          const modelId = getStore().get<string>('magpie_default_model_id')?.trim();
          return enabled && Boolean(modelId);
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
          const coworkStoreInstance = getCoworkStore();
          if (!coworkStoreInstance.getSession(sessionId)) {
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
          const expertSelection = expertIds
            ? resolveCodingExpertSelection({
                expertIds,
                resolveSnapshots: resolveSessionExpertSnapshots,
              })
            : null;
          // Resolving comes first: a stale expert id throws. Pi's agent_start
          // event is the single source of truth for the running state.
          const sharedOptions = {
            workspaceRoot,
            sessionMode: 'work' as const,
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
          };
          // One lane keeps one Pi transcript: reusing the live session preserves
          // the earlier turns that startSession would discard.
          if (runtime.isSessionActive(sessionId)) {
            await runtime.continueSession(sessionId, prompt, {
              ...sharedOptions,
              _skipUserMessage: true,
            });
            return;
          }
          await runtime.startSession(sessionId, prompt, {
            ...sharedOptions,
            confirmationMode: 'modal',
            skipInitialUserMessage: true,
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
        listCommandChoices: () => ({
          skills: getSkillManager()
            .listSkills()
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
        describeBuiltinMcp: (target?: string) => {
          const statuses = new Map(
            (rt.mcpServerManager?.serverStatuses ?? []).map(
              status => [status.name, status] as const,
            ),
          );
          const manifest = rt.mcpServerManager?.toolManifest ?? [];
          return {
            gatewayAvailable: rt.piRuntimeAdapter?.hasMcpServerManager() ?? false,
            target: target ?? null,
            servers: getMcpStore()
              .listServers()
              .filter(server => !target || server.name === target)
              .map(server => {
                const status = statuses.get(server.name);
                return {
                  name: server.name,
                  enabled: server.enabled,
                  connected: status?.connected ?? false,
                  toolCount: status?.toolCount ?? 0,
                  ...(status?.error ? { error: status.error } : {}),
                };
              }),
            tools: manifest
              .filter(entry => !target || entry.server === target)
              .map(entry => ({ server: entry.server, name: entry.name })),
          };
        },
        enqueueBuiltinControlAction: (sessionId, action) =>
          runtime.enqueueControlAction(sessionId, action),
        isBuiltinSessionRunning: sessionId => runtime.isSessionRunning(sessionId),
        isBuiltinSessionActive: sessionId => runtime.isSessionActive(sessionId),
        enqueueBuiltinMessage: (sessionId, prompt) =>
          runtime.enqueuePendingMessage(sessionId, prompt),
        steerBuiltinMessage: async (sessionId, prompt) => {
          const queued = runtime.enqueuePendingMessage(sessionId, prompt);
          if (!queued.success || !queued.item) return queued;
          return await runtime.steerPendingMessage(sessionId, queued.item.id);
        },
        getBuiltinWorkbenchLink: sessionId => {
          const detail = getWorkbenchTaskService().getCurrent(sessionId);
          const runId = detail?.task.activeRunId;
          return detail && runId ? { taskId: detail.task.id, runId } : null;
        },
        beginExternalWorkbenchRun: ({ sessionId, goal, workspaceRoot }) => {
          const workbench = getWorkbenchTaskService().beginRun({
            sessionId,
            goal,
            contract: {
              kind: WorkbenchContractKind.GenericWork,
              requiresUserAcceptance: true,
              metadata: { codingAgent: true, workspaceRoot },
            },
            trigger: WorkbenchRunTrigger.Message,
          });
          getWorkbenchTaskService().updateRunContext(workbench.run.id, {
            model: 'external-agent',
            provider: 'external-agent',
            reasoningProfile: 'external',
            workspaceRoot,
            skillIds: [],
          });
          return { taskId: workbench.task.id, runId: workbench.run.id };
        },
        completeExternalWorkbenchRun: async ({ sessionId, runId, workspaceRoot, finalAnswer }) => {
          await getWorkbenchTaskService().completeRun({
            sessionId,
            runId,
            workspaceRoot,
            finalAnswer,
          });
        },
        failExternalWorkbenchRun: ({ sessionId, error }) => {
          getWorkbenchTaskService().failRun(sessionId, { message: error });
        },
        cancelExternalWorkbenchRun: ({ sessionId, runId }) => {
          getWorkbenchTaskService().cancelRun(sessionId, runId);
        },
        respondBuiltinPermission: (requestId, approved) =>
          runtime.respondToPermission(
            requestId,
            approved
              ? { behavior: 'allow' }
              : { behavior: 'deny', message: 'The user denied this coding permission.' },
          ),
        validateBuiltinModel: async () => {
          const probe = await probeCoworkModelReadiness();
          if (probe.ok === false) throw new Error(probe.error);
        },
        createIsolatedWorkspace: async ({ workspaceRoot, laneId, baseline }) => {
          const service = new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          );
          return await service.create({ repositoryRoot: workspaceRoot, laneId, baseline });
        },
        getWorkspaceBaseline: async workspaceRoot => {
          try {
            return await GitWorktreeService.getBaseline(workspaceRoot);
          } catch {
            return null;
          }
        },
        getWorkspaceDiff: async workspaceRoot =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).getWorktreeDiffPreview(workspaceRoot),
        applyWorkspacePatch: async ({ workspaceRoot, patch }) =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).applyPatch(workspaceRoot, patch),
        getIsolatedWorkspaceDiff: async workspaceRoot =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).getWorktreeDiffPreview(workspaceRoot),
        applyIsolatedWorkspaceDiff: async ({ workspaceRoot, isolatedWorkspaceRoot }) =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).applyWorktreeDiff({
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
    rt.codingRoomService.registry.hydrate();
    runtime.on('message', (sessionId: string, message: unknown) => {
      const metadata =
        message && typeof message === 'object' && 'metadata' in message
          ? (message as { metadata?: unknown }).metadata
          : null;
      const isThinking =
        metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          ? (metadata as { isThinking?: unknown }).isThinking === true
          : false;
      if (isThinking) {
        rt.codingRoomService?.recordBuiltinEvent(sessionId, CodingEventKind.Reasoning, {
          message,
          streamUpdateMode: CodingStreamUpdateMode.Replace,
        });
        return;
      }
      const normalized = normalizePiMessage(message);
      if (normalized)
        rt.codingRoomService?.recordBuiltinEvent(sessionId, normalized.kind, normalized.payload);
    });
    runtime.on(
      'messageUpdate',
      (
        sessionId: string,
        messageId: string,
        content: string,
        metadata?: Record<string, unknown>,
      ) => {
        const isThinking = metadata?.isThinking === true;
        rt.codingRoomService?.recordBuiltinEvent(
          sessionId,
          isThinking ? CodingEventKind.Reasoning : CodingEventKind.MessageDelta,
          {
            content,
            messageId,
            streamUpdateMode: CodingStreamUpdateMode.Replace,
          },
        );
      },
    );
    runtime.on('toolActivity', (sessionId: string, event: CoworkToolActivityEvent) => {
      const normalized = normalizePiToolActivity(event);
      if (normalized)
        rt.codingRoomService?.recordBuiltinEvent(sessionId, normalized.kind, normalized.payload);
    });
    runtime.on('permissionRequest', (sessionId: string, request: unknown) => {
      const requestId =
        request &&
        typeof request === 'object' &&
        typeof (request as { requestId?: unknown }).requestId === 'string'
          ? (request as { requestId: string }).requestId
          : null;
      rt.codingRoomService?.recordBuiltinEvent(sessionId, CodingEventKind.Permission, {
        requestId,
        request,
      });
    });
    runtime.on('plan', (sessionId: string, plan: { entries?: unknown }) => {
      rt.codingRoomService?.recordBuiltinEvent(sessionId, CodingEventKind.Plan, {
        entries: Array.isArray(plan?.entries) ? plan.entries : [],
      });
    });
    runtime.on(
      'codingElicitationRequest',
      (sessionId: string, request: { requestId: string; question: string }) => {
        rt.codingRoomService?.recordBuiltinElicitation(sessionId, request);
      },
    );
    runtime.on('complete', (sessionId: string) => {
      rt.codingRoomService?.recordBuiltinEvent(sessionId, CodingEventKind.TurnComplete, {});
    });
    runtime.on('error', (sessionId: string, error: unknown) => {
      rt.codingRoomService?.recordBuiltinEvent(sessionId, CodingEventKind.TurnFailed, { error });
    });
    runtime.on(
      'retryNotice',
      (sessionId: string, notice: Omit<RuntimeRetryNotice, 'sessionId'>) => {
        // Transient status: the shared prompt tells the user the model answered
        // with an error while Pi keeps retrying, instead of leaving the turn
        // looking frozen until the retry cycle settles.
        const payload: RuntimeRetryNotice = { sessionId, ...notice };
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send(RuntimeNoticeIpc.Notice, payload);
        }
      },
    );
    runtime.on('sessionInterrupted', interruption => {
      if (interruption.cause !== CoworkInterruptionCause.UserStop) {
        rt.codingRoomService?.recordBuiltinInterruption(interruption);
      }
    });
  }
  return rt.codingRoomService;
};
