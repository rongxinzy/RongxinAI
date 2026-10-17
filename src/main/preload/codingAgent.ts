import { ipcRenderer } from 'electron';

import { CodingAgentIpc } from '../../shared/codingAgent';
import { onPush } from './pushChannel';

// Coding agent workspaces, lanes, git flows, and auth terminals.
export const codingAgentApi = {
  codingAgent: {
    listProfiles: () => ipcRenderer.invoke(CodingAgentIpc.ListProfiles),
    listWorkspaces: () => ipcRenderer.invoke(CodingAgentIpc.ListWorkspaces),
    createWorkspace: (input: import('../../shared/codingAgent').CreateCodingWorkspaceInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CreateWorkspace, input),
    updateWorkspace: (input: import('../../shared/codingAgent').UpdateCodingWorkspaceInput) =>
      ipcRenderer.invoke(CodingAgentIpc.UpdateWorkspace, input),
    deleteWorkspace: (workspaceId: string) =>
      ipcRenderer.invoke(CodingAgentIpc.DeleteWorkspace, workspaceId),
    deleteSession: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.DeleteSession, input),
    getProfileConfigOptions: (profileId: string) =>
      ipcRenderer.invoke(CodingAgentIpc.GetProfileConfigOptions, profileId),
    getProfileAvailableCommands: (profileId: string) =>
      ipcRenderer.invoke(CodingAgentIpc.GetProfileAvailableCommands, profileId),
    createSession: (input: import('../../shared/codingAgent').CreateCodingSessionInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CreateSession, input),
    startSession: (input: import('../../shared/codingAgent').StartCodingSessionInput) =>
      ipcRenderer.invoke(CodingAgentIpc.StartSession, input),
    bootstrap: (workspaceRoot: string) =>
      ipcRenderer.invoke(CodingAgentIpc.Bootstrap, workspaceRoot),
    loadEventPage: (input: {
      workspaceRoot: string;
      laneId: string;
      beforeSequence: number | null;
    }) => ipcRenderer.invoke(CodingAgentIpc.LoadEventPage, input),
    prepareLane: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.PrepareLane, input),
    createMission: (input: import('../../shared/codingAgent').CreateCodingMissionInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CreateMission, input),
    selectLane: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.SelectLane, input),
    prompt: (input: {
      workspaceRoot: string;
      prompt: import('../../shared/codingAgent').CodingPromptInput;
    }) => ipcRenderer.invoke(CodingAgentIpc.Prompt, input),
    listPendingMessages: (laneId: string) =>
      ipcRenderer.invoke(CodingAgentIpc.ListPendingMessages, laneId),
    enqueuePendingMessage: (input: { laneId: string; text: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.EnqueuePendingMessage, input),
    updatePendingMessage: (input: { laneId: string; itemId: string; text: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.UpdatePendingMessage, input),
    deletePendingMessage: (input: { laneId: string; itemId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.DeletePendingMessage, input),
    steerPendingMessage: (input: { workspaceRoot: string; laneId: string; itemId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.SteerPendingMessage, input),
    followUpPendingMessage: (input: { workspaceRoot: string; laneId: string; itemId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.FollowUpPendingMessage, input),
    confirmSessionRecovery: (input: {
      workspaceRoot: string;
      laneId: string;
      includeRecoveryContext: boolean;
    }) => ipcRenderer.invoke(CodingAgentIpc.ConfirmSessionRecovery, input),
    cancel: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.Cancel, input),
    respondElicitation: (input: {
      workspaceRoot: string;
      response: import('../../shared/codingAgent').CodingElicitationResponse;
    }) => ipcRenderer.invoke(CodingAgentIpc.RespondElicitation, input),
    cancelElicitation: (input: { workspaceRoot: string; requestId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.CancelElicitation, input),
    previewHandoff: (input: {
      workspaceRoot: string;
      sourceLaneId: string;
      targetLaneId: string;
    }) => ipcRenderer.invoke(CodingAgentIpc.PreviewHandoff, input),
    handoff: (input: { workspaceRoot: string; sourceLaneId: string; targetLaneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.Handoff, input),
    addLane: (input: { workspaceRoot: string; missionId: string; profileId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.AddLane, input),
    createCollaborationPreset: (
      input: import('../../shared/codingAgent').CreateCodingCollaborationPresetInput,
    ) => ipcRenderer.invoke(CodingAgentIpc.CreateCollaborationPreset, input),
    saveLaneView: (input: {
      workspaceRoot: string;
      view: import('../../shared/codingAgent').CodingLaneViewStateInput;
    }) => ipcRenderer.invoke(CodingAgentIpc.SaveLaneView, input),
    setLaneConfigOption: (input: {
      workspaceRoot: string;
      option: import('../../shared/codingAgent').CodingLaneConfigOptionInput;
    }) => ipcRenderer.invoke(CodingAgentIpc.SetLaneConfigOption, input),
    setLaneModelOverride: (input: {
      workspaceRoot: string;
      laneId: string;
      modelOverride: string | null;
    }) => ipcRenderer.invoke(CodingAgentIpc.SetLaneModelOverride, input),
    previewLaneChanges: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.PreviewLaneChanges, input),
    applyLaneChanges: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.ApplyLaneChanges, input),
    getGitStatus: (input: import('../../shared/codingAgent').CodingGitTargetInput) =>
      ipcRenderer.invoke(CodingAgentIpc.GetGitStatus, input),
    getGitDiff: (input: import('../../shared/codingAgent').CodingGitDiffInput) =>
      ipcRenderer.invoke(CodingAgentIpc.GetGitDiff, input),
    stageGitPaths: (input: import('../../shared/codingAgent').CodingGitPathActionInput) =>
      ipcRenderer.invoke(CodingAgentIpc.StageGitPaths, input),
    unstageGitPaths: (input: import('../../shared/codingAgent').CodingGitPathActionInput) =>
      ipcRenderer.invoke(CodingAgentIpc.UnstageGitPaths, input),
    commitGitChanges: (input: import('../../shared/codingAgent').CodingGitCommitInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CommitGitChanges, input),
    commitAndPushGitChanges: (
      input: import('../../shared/codingAgent').CodingGitCommitAndPushInput,
    ) => ipcRenderer.invoke(CodingAgentIpc.CommitAndPushGitChanges, input),
    pushGitBranch: (input: import('../../shared/codingAgent').CodingGitTargetInput) =>
      ipcRenderer.invoke(CodingAgentIpc.PushGitBranch, input),
    switchGitBranch: (input: import('../../shared/codingAgent').CodingGitBranchInput) =>
      ipcRenderer.invoke(CodingAgentIpc.SwitchGitBranch, input),
    createGitBranch: (input: import('../../shared/codingAgent').CodingGitBranchInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CreateGitBranch, input),
    createGitPullRequest: (input: import('../../shared/codingAgent').CodingGitPullRequestInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CreateGitPullRequest, input),
    listWorkspaceFiles: (input: import('../../shared/codingAgent').CodingWorkspaceFileInput) =>
      ipcRenderer.invoke(CodingAgentIpc.ListWorkspaceFiles, input),
    readWorkspaceFile: (input: import('../../shared/codingAgent').CodingWorkspaceFileInput) =>
      ipcRenderer.invoke(CodingAgentIpc.ReadWorkspaceFile, input),
    writeWorkspaceFile: (input: import('../../shared/codingAgent').CodingWorkspaceFileWriteInput) =>
      ipcRenderer.invoke(CodingAgentIpc.WriteWorkspaceFile, input),
    discoverAgents: (input: { workspaceRoot: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.DiscoverAgents, input),
    probeAgent: (input: { workspaceRoot: string; profileId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.ProbeAgent, input),
    addProfile: (input: {
      workspaceRoot: string;
      profile: import('../../shared/codingAgent').AddCodingAgentProfileInput;
    }) => ipcRenderer.invoke(CodingAgentIpc.AddProfile, input),
    trustProfile: (input: { workspaceRoot: string; profileId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.TrustProfile, input),
    authenticateProfile: (input: { workspaceRoot: string; profileId: string; methodId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.AuthenticateProfile, input),
    startAuthTerminal: (input: { workspaceRoot: string; profileId: string; methodId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.StartAuthTerminal, input),
    writeAuthTerminal: (input: { id: string; data: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.WriteAuthTerminal, input),
    resizeAuthTerminal: (input: { id: string; columns: number; rows: number }) =>
      ipcRenderer.invoke(CodingAgentIpc.ResizeAuthTerminal, input),
    cancelAuthTerminal: (id: string) => ipcRenderer.invoke(CodingAgentIpc.CancelAuthTerminal, id),
    respondPermission: (input: {
      workspaceRoot: string;
      response: import('../../shared/codingAgent').CodingPermissionResponse;
    }) => ipcRenderer.invoke(CodingAgentIpc.RespondPermission, input),
    onChanged: (
      callback: (snapshot: import('../../shared/codingAgent').CodingRoomSnapshot) => void,
    ) => onPush(CodingAgentIpc.Changed, callback),
    onEventDelta: (
      callback: (delta: import('../../shared/codingAgent').CodingRoomEventDelta) => void,
    ) => onPush(CodingAgentIpc.EventDelta, callback),
    onPendingMessagesChanged: (
      callback: (
        event: import('../../shared/codingAgent').CodingPendingMessagesChangedEvent,
      ) => void,
    ) => onPush(CodingAgentIpc.PendingMessagesChanged, callback),
    onAuthTerminalData: (callback: (event: { id: string; data: string }) => void) =>
      onPush(CodingAgentIpc.AuthTerminalData, callback),
    onAuthTerminalExit: (
      callback: (event: {
        id: string;
        profileId: string;
        methodId: string;
        exitCode: number;
        signal?: number;
      }) => void,
    ) => onPush(CodingAgentIpc.AuthTerminalExit, callback),
  },
};
