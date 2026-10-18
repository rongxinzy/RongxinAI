import { BrowserWindow } from 'electron';

import {
  CodingAgentIpc,
  CodingEventWindowPageSize,
  type AddCodingAgentProfileInput,
  type CodingGitCommitInput,
  type CodingGitCommitAndPushInput,
  type CodingGitBranchInput,
  type CodingGitPullRequestInput,
  type CodingGitDiffInput,
  type CodingGitPathActionInput,
  type CodingGitTargetInput,
  type CodingWorkspaceFileInput,
  type CodingWorkspaceFileWriteInput,
  type CodingLaneViewStateInput,
  type CodingLaneConfigOptionInput,
  type CodingPermissionResponse,
  type CodingElicitationResponse,
  type CreateCodingCollaborationPresetInput,
  type CodingPromptInput,
  type CodingRoomEventDelta,
  type CreateCodingSessionInput,
  type StartCodingSessionInput,
  type CreateCodingWorkspaceInput,
  type CreateCodingMissionInput,
  type UpdateCodingWorkspaceInput,
} from '../../shared/codingAgent';
import type { CodingRoomService } from '../codingAgent/codingRoomService';
import { GitWorktreeConflictError } from '../codingAgent/gitWorktreeService';
import { agentResourceDiagnostics } from '../agentResourceDiagnostics';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { codingAgentContract } from '../../shared/ipc/codingAgentContract';

type CodingHandler<T> = () => T | Promise<T>;

/**
 * Single entry point for every coding IPC handler: a failure is logged with its
 * channel and normalised into the `{ success: false, error }` shape the
 * renderer already understands. `describeFailure` adds channel-specific fields
 * on top of that shape (e.g. the Git worktree conflict flag).
 */
async function runCodingHandler<T>(
  channel: string,
  run: CodingHandler<T>,
  describeFailure?: (error: unknown) => Record<string, unknown>,
): Promise<T | { success: false; error: string }> {
  try {
    return await run();
  } catch (error) {
    console.error(`[CodingAgentIpc] ${channel} failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      ...describeFailure?.(error),
    };
  }
}

export function registerCodingAgentIpcHandlers(getService: () => CodingRoomService): void {
  const service = getService();
  service.on('changed', snapshot => {
    agentResourceDiagnostics.recordRoomSnapshot(snapshot.events.length, snapshot.lanes.length);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CodingAgentIpc.Changed, snapshot);
    }
  });
  service.on('pendingMessagesChanged', event => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed())
        window.webContents.send(CodingAgentIpc.PendingMessagesChanged, event);
    }
  });
  service.on('authTerminalData', event => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CodingAgentIpc.AuthTerminalData, event);
    }
  });
  service.on('authTerminalExit', event => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CodingAgentIpc.AuthTerminalExit, event);
    }
  });
  service.on('eventDelta', (delta: CodingRoomEventDelta) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CodingAgentIpc.EventDelta, delta);
    }
  });
  handleIpcContract(codingAgentContract, {
    listProfiles: () =>
      runCodingHandler(CodingAgentIpc.ListProfiles, () => {
        return { success: true, profiles: service.listProfiles() };
      }),
    listWorkspaces: () =>
      runCodingHandler(CodingAgentIpc.ListWorkspaces, () => {
        return { success: true, workspaces: service.listWorkspaces() };
      }),
    createWorkspace: (_event, input: CreateCodingWorkspaceInput) =>
      runCodingHandler(CodingAgentIpc.CreateWorkspace, () => {
        return { success: true, workspaces: service.createWorkspace(input) };
      }),
    updateWorkspace: (_event, input: UpdateCodingWorkspaceInput) =>
      runCodingHandler(CodingAgentIpc.UpdateWorkspace, () => {
        return { success: true, workspaces: service.updateWorkspace(input) };
      }),
    deleteWorkspace: (_event, workspaceId: string) =>
      runCodingHandler(CodingAgentIpc.DeleteWorkspace, () => {
        return { success: true, workspaces: service.deleteWorkspace(workspaceId) };
      }),
    deleteSession: (_event, input: { workspaceRoot: string; laneId: string }) =>
      runCodingHandler(CodingAgentIpc.DeleteSession, () => {
        return {
          success: true,
          workspaces: service.deleteSession(input.workspaceRoot, input.laneId),
        };
      }),
    getProfileConfigOptions: (_event, profileId: string) =>
      runCodingHandler(CodingAgentIpc.GetProfileConfigOptions, () => {
        return { success: true, configOptions: service.getProfileConfigOptions(profileId) };
      }),
    getProfileAvailableCommands: (_event, profileId: string) =>
      runCodingHandler(CodingAgentIpc.GetProfileAvailableCommands, () => {
        return { success: true, commands: service.getProfileAvailableCommands(profileId) };
      }),
    createSession: (_event, input: CreateCodingSessionInput) =>
      runCodingHandler(CodingAgentIpc.CreateSession, async () => {
        return { success: true, snapshot: await service.createSession(input) };
      }),
    startSession: (_event, input: StartCodingSessionInput) =>
      runCodingHandler(CodingAgentIpc.StartSession, async () => {
        return { success: true, snapshot: await service.startSession(input) };
      }),
    bootstrap: (_event, workspaceRoot: string) =>
      runCodingHandler(CodingAgentIpc.Bootstrap, () => {
        return {
          success: true,
          snapshot: service.bootstrap(workspaceRoot, {
            eventLimitPerLane: CodingEventWindowPageSize,
          }),
        };
      }),
    loadEventPage: (
      _event,
      input: { workspaceRoot: string; laneId: string; beforeSequence: number | null },
    ) =>
      runCodingHandler(CodingAgentIpc.LoadEventPage, () => {
        return {
          success: true,
          page: service.loadEventPage(input.workspaceRoot, input.laneId, input.beforeSequence),
        };
      }),
    prepareLane: (_event, input: { workspaceRoot: string; laneId: string }) =>
      runCodingHandler(CodingAgentIpc.PrepareLane, async () => {
        return {
          success: true,
          snapshot: await service.prepareLane(input.workspaceRoot, input.laneId),
        };
      }),
    createMission: (_event, input: CreateCodingMissionInput) =>
      runCodingHandler(CodingAgentIpc.CreateMission, async () => {
        return { success: true, snapshot: await service.createMission(input) };
      }),
    selectLane: (_event, input: { workspaceRoot: string; laneId: string }) =>
      runCodingHandler(CodingAgentIpc.SelectLane, () => {
        return { success: true, snapshot: service.selectLane(input.workspaceRoot, input.laneId) };
      }),
    prompt: (_event, input: { workspaceRoot: string; prompt: CodingPromptInput }) =>
      runCodingHandler(CodingAgentIpc.Prompt, async () => {
        return { success: true, snapshot: await service.prompt(input.workspaceRoot, input.prompt) };
      }),
    listPendingMessages: (_event, laneId: string) => ({
      success: true,
      items: service.listPendingMessages(laneId),
    }),
    enqueuePendingMessage: (_event, input: { laneId: string; text: string }) =>
      service.enqueuePendingMessage(input.laneId, input.text),
    updatePendingMessage: (_event, input: { laneId: string; itemId: string; text: string }) =>
      service.updatePendingMessage(input.laneId, input.itemId, input.text),
    deletePendingMessage: (_event, input: { laneId: string; itemId: string }) =>
      service.deletePendingMessage(input.laneId, input.itemId),
    steerPendingMessage: (
      _event,
      input: { workspaceRoot: string; laneId: string; itemId: string },
    ) =>
      runCodingHandler(CodingAgentIpc.SteerPendingMessage, async () => {
        return {
          success: true,
          snapshot: await service.steerPendingMessage(
            input.workspaceRoot,
            input.laneId,
            input.itemId,
          ),
        };
      }),
    followUpPendingMessage: (
      _event,
      input: { workspaceRoot: string; laneId: string; itemId: string },
    ) =>
      runCodingHandler(CodingAgentIpc.FollowUpPendingMessage, async () => {
        return {
          success: true,
          snapshot: await service.followUpPendingMessage(
            input.workspaceRoot,
            input.laneId,
            input.itemId,
          ),
        };
      }),
    confirmSessionRecovery: (
      _event,
      input: { workspaceRoot: string; laneId: string; includeRecoveryContext: boolean },
    ) =>
      runCodingHandler(CodingAgentIpc.ConfirmSessionRecovery, async () => {
        return {
          success: true,
          snapshot: await service.confirmSessionRecovery(
            input.workspaceRoot,
            input.laneId,
            input.includeRecoveryContext,
          ),
        };
      }),
    cancel: (_event, input: { workspaceRoot: string; laneId: string }) =>
      runCodingHandler(CodingAgentIpc.Cancel, async () => {
        return { success: true, snapshot: await service.cancel(input.workspaceRoot, input.laneId) };
      }),
    previewHandoff: (
      _event,
      input: { workspaceRoot: string; sourceLaneId: string; targetLaneId: string },
    ) =>
      runCodingHandler(CodingAgentIpc.PreviewHandoff, async () => {
        return {
          success: true,
          content: await service.previewHandoff(
            input.workspaceRoot,
            input.sourceLaneId,
            input.targetLaneId,
          ),
        };
      }),
    handoff: (
      _event,
      input: { workspaceRoot: string; sourceLaneId: string; targetLaneId: string },
    ) =>
      runCodingHandler(CodingAgentIpc.Handoff, async () => {
        return {
          success: true,
          snapshot: await service.handoff(
            input.workspaceRoot,
            input.sourceLaneId,
            input.targetLaneId,
          ),
        };
      }),
    createCollaborationPreset: (_event, input: CreateCodingCollaborationPresetInput) =>
      runCodingHandler(CodingAgentIpc.CreateCollaborationPreset, async () => {
        return {
          success: true,
          snapshot: await service.createImplementationReviewVerificationPreset(input),
        };
      }),
    addLane: (_event, input: { workspaceRoot: string; missionId: string; profileId: string }) =>
      runCodingHandler(CodingAgentIpc.AddLane, async () => {
        return {
          success: true,
          snapshot: await service.addLane(input.workspaceRoot, input.missionId, input.profileId),
        };
      }),
    saveLaneView: (_event, input: { workspaceRoot: string; view: CodingLaneViewStateInput }) =>
      runCodingHandler(CodingAgentIpc.SaveLaneView, () => {
        return { success: true, snapshot: service.saveLaneView(input.workspaceRoot, input.view) };
      }),
    previewLaneChanges: (_event, input: { workspaceRoot: string; laneId: string }) =>
      runCodingHandler(CodingAgentIpc.PreviewLaneChanges, async () => {
        return {
          success: true,
          preview: await service.previewLaneChanges(input.workspaceRoot, input.laneId),
        };
      }),
    applyLaneChanges: (_event, input: { workspaceRoot: string; laneId: string }) =>
      runCodingHandler(
        CodingAgentIpc.ApplyLaneChanges,
        async () => {
          return {
            success: true,
            snapshot: await service.applyLaneChanges(input.workspaceRoot, input.laneId),
          };
        },
        error => ({ conflict: error instanceof GitWorktreeConflictError }),
      ),
    getGitStatus: (_event, input: CodingGitTargetInput) =>
      runCodingHandler(CodingAgentIpc.GetGitStatus, async () => {
        return { success: true, status: await service.getGitStatus(input) };
      }),
    getGitDiff: (_event, input: CodingGitDiffInput) =>
      runCodingHandler(CodingAgentIpc.GetGitDiff, async () => {
        return { success: true, diff: await service.getGitDiff(input) };
      }),
    stageGitPaths: (_event, input: CodingGitPathActionInput) =>
      runCodingHandler(CodingAgentIpc.StageGitPaths, async () => {
        return { success: true, status: await service.stageGitPaths(input) };
      }),
    unstageGitPaths: (_event, input: CodingGitPathActionInput) =>
      runCodingHandler(CodingAgentIpc.UnstageGitPaths, async () => {
        return { success: true, status: await service.unstageGitPaths(input) };
      }),
    commitGitChanges: (_event, input: CodingGitCommitInput) =>
      runCodingHandler(CodingAgentIpc.CommitGitChanges, async () => {
        console.debug(
          `[CodingGit] received a commit request with ${input.paths.length} selected path(s)`,
        );
        return { success: true, status: await service.commitGitChanges(input) };
      }),
    commitAndPushGitChanges: (_event, input: CodingGitCommitAndPushInput) =>
      runCodingHandler(CodingAgentIpc.CommitAndPushGitChanges, async () => {
        console.debug(
          `[CodingGit] received a commit and push request with ${input.paths.length} selected path(s)`,
        );
        return { success: true, result: await service.commitAndPushGitChanges(input) };
      }),
    pushGitBranch: (_event, input: CodingGitTargetInput) =>
      runCodingHandler(CodingAgentIpc.PushGitBranch, async () => {
        return { success: true, status: await service.pushGitBranch(input) };
      }),
    switchGitBranch: (_event, input: CodingGitBranchInput) =>
      runCodingHandler(CodingAgentIpc.SwitchGitBranch, async () => {
        return { success: true, status: await service.switchGitBranch(input) };
      }),
    createGitBranch: (_event, input: CodingGitBranchInput) =>
      runCodingHandler(CodingAgentIpc.CreateGitBranch, async () => {
        return { success: true, status: await service.createGitBranch(input) };
      }),
    createGitPullRequest: (_event, input: CodingGitPullRequestInput) =>
      runCodingHandler(CodingAgentIpc.CreateGitPullRequest, async () => {
        return { success: true, url: await service.createGitPullRequest(input) };
      }),
    listWorkspaceFiles: (_event, input: CodingWorkspaceFileInput) =>
      runCodingHandler(CodingAgentIpc.ListWorkspaceFiles, async () => {
        return { success: true, entries: await service.listWorkspaceFiles(input) };
      }),
    readWorkspaceFile: (_event, input: CodingWorkspaceFileInput) =>
      runCodingHandler(CodingAgentIpc.ReadWorkspaceFile, async () => {
        return { success: true, file: await service.readWorkspaceFile(input) };
      }),
    writeWorkspaceFile: (_event, input: CodingWorkspaceFileWriteInput) =>
      runCodingHandler(CodingAgentIpc.WriteWorkspaceFile, async () => {
        return { success: true, file: await service.writeWorkspaceFile(input) };
      }),
    setLaneConfigOption: (
      _event,
      input: { workspaceRoot: string; option: CodingLaneConfigOptionInput },
    ) =>
      runCodingHandler(CodingAgentIpc.SetLaneConfigOption, async () => {
        return {
          success: true,
          snapshot: await service.setLaneConfigOption(input.workspaceRoot, input.option),
        };
      }),
    setLaneModelOverride: (
      _event,
      input: { workspaceRoot: string; laneId: string; modelOverride: string | null },
    ) =>
      runCodingHandler(CodingAgentIpc.SetLaneModelOverride, async () => {
        return {
          success: true,
          snapshot: await service.setLaneModelOverride(
            input.workspaceRoot,
            input.laneId,
            input.modelOverride,
          ),
        };
      }),
    discoverAgents: (_event, input: { workspaceRoot: string }) =>
      runCodingHandler(CodingAgentIpc.DiscoverAgents, async () => {
        return {
          success: true,
          snapshot: (await service.discoverAgents(input.workspaceRoot)) ?? undefined,
          profiles: service.listProfiles(),
        };
      }),
    probeAgent: (_event, input: { workspaceRoot: string; profileId: string }) =>
      runCodingHandler(CodingAgentIpc.ProbeAgent, async () => {
        return {
          success: true,
          snapshot: (await service.probeAgent(input.workspaceRoot, input.profileId)) ?? undefined,
          profiles: service.listProfiles(),
        };
      }),
    addProfile: (_event, input: { workspaceRoot: string; profile: AddCodingAgentProfileInput }) =>
      runCodingHandler(CodingAgentIpc.AddProfile, () => {
        return {
          success: true,
          snapshot: service.addProfile(input.workspaceRoot, input.profile) ?? undefined,
          profiles: service.listProfiles(),
        };
      }),
    trustProfile: (_event, input: { workspaceRoot: string; profileId: string }) =>
      runCodingHandler(CodingAgentIpc.TrustProfile, () => {
        return {
          success: true,
          snapshot: service.trustProfile(input.workspaceRoot, input.profileId) ?? undefined,
          profiles: service.listProfiles(),
        };
      }),
    authenticateProfile: (
      _event,
      input: { workspaceRoot: string; profileId: string; methodId: string },
    ) =>
      runCodingHandler(CodingAgentIpc.AuthenticateProfile, async () => {
        return {
          success: true,
          snapshot: await service.authenticateProfile(
            input.workspaceRoot,
            input.profileId,
            input.methodId,
          ),
        };
      }),
    startAuthTerminal: (
      _event,
      input: { workspaceRoot: string; profileId: string; methodId: string },
    ) =>
      runCodingHandler(CodingAgentIpc.StartAuthTerminal, () => {
        return {
          success: true,
          terminal: service.startTerminalAuthentication(
            input.workspaceRoot,
            input.profileId,
            input.methodId,
          ),
        };
      }),
    writeAuthTerminal: (_event, input: { id: string; data: string }) =>
      runCodingHandler(CodingAgentIpc.WriteAuthTerminal, () => {
        service.writeAuthTerminal(input.id, input.data);
        return { success: true };
      }),
    resizeAuthTerminal: (_event, input: { id: string; columns: number; rows: number }) =>
      runCodingHandler(CodingAgentIpc.ResizeAuthTerminal, () => {
        service.resizeAuthTerminal(input.id, input.columns, input.rows);
        return { success: true };
      }),
    cancelAuthTerminal: (_event, id: string) =>
      runCodingHandler(CodingAgentIpc.CancelAuthTerminal, () => {
        service.cancelAuthTerminal(id);
        return { success: true };
      }),
    respondPermission: (
      _event,
      input: { workspaceRoot: string; response: CodingPermissionResponse },
    ) =>
      runCodingHandler(CodingAgentIpc.RespondPermission, async () => {
        return {
          success: true,
          snapshot: await service.respondToPermission(input.workspaceRoot, input.response),
        };
      }),
    respondElicitation: (
      _event,
      input: { workspaceRoot: string; response: CodingElicitationResponse },
    ) =>
      runCodingHandler(CodingAgentIpc.RespondElicitation, async () => {
        return {
          success: true,
          snapshot: await service.respondElicitation(input.workspaceRoot, input.response),
        };
      }),
    cancelElicitation: (_event, input: { workspaceRoot: string; requestId: string }) =>
      runCodingHandler(CodingAgentIpc.CancelElicitation, async () => {
        return {
          success: true,
          snapshot: await service.cancelElicitation(input.workspaceRoot, input.requestId),
        };
      }),
  });
}
