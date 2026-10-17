/**
 * Coding agent preload surface, split from `../electron.d.ts`.
 *
 * Contains the result envelopes for coding-agent IPC calls and the
 * `codingAgent` namespace (profiles, workspaces, lanes, missions, prompt
 * steering, git operations, auth terminals, room events).
 */
import type { CodingAgentProfile, CodingRoomSnapshot } from '../../../shared/codingAgent';

interface CodingAgentActionResult {
  success: boolean;
  error?: string;
  conflict?: boolean;
  snapshot?: CodingRoomSnapshot;
  /** Profiles for manager actions that run before a workspace is open. */
  profiles?: CodingAgentProfile[];
}

interface CodingHandoffPreviewResult {
  success: boolean;
  content?: Record<string, unknown>;
  error?: string;
}

interface CodingLaneChangePreviewResult {
  success: boolean;
  preview?: import('../../../shared/codingAgent').CodingLaneChangePreview;
  error?: string;
}
interface CodingGitStatusResult {
  success: boolean;
  status?: import('../../../shared/codingAgent').CodingGitStatus;
  error?: string;
}
interface CodingGitCommitAndPushActionResult {
  success: boolean;
  result?: import('../../../shared/codingAgent').CodingGitCommitAndPushResult;
  error?: string;
}
interface CodingGitDiffResult {
  success: boolean;
  diff?: string;
  error?: string;
}
interface CodingWorkspaceActionResult {
  success: boolean;
  workspaces?: import('../../../shared/codingAgent').CodingWorkspaceSummary[];
  error?: string;
}
interface CodingAgentProfilesResult {
  success: boolean;
  profiles?: import('../../../shared/codingAgent').CodingAgentProfile[];
  error?: string;
}
interface CodingAgentConfigOptionsResult {
  success: boolean;
  configOptions?: import('../../../shared/codingAgent').CodingAgentConfigOption[];
  error?: string;
}
interface CodingAgentCommandsResult {
  success: boolean;
  commands?: import('../../../shared/codingAgent').CodingAgentAvailableCommand[];
  error?: string;
}

export interface CodingAgentApi {
  listProfiles: () => Promise<CodingAgentProfilesResult>;
  listWorkspaces: () => Promise<CodingWorkspaceActionResult>;
  createWorkspace: (
    input: import('../../../shared/codingAgent').CreateCodingWorkspaceInput,
  ) => Promise<CodingWorkspaceActionResult>;
  updateWorkspace: (
    input: import('../../../shared/codingAgent').UpdateCodingWorkspaceInput,
  ) => Promise<CodingWorkspaceActionResult>;
  deleteWorkspace: (workspaceId: string) => Promise<CodingWorkspaceActionResult>;
  deleteSession: (input: {
    workspaceRoot: string;
    laneId: string;
  }) => Promise<CodingWorkspaceActionResult>;
  getProfileConfigOptions: (profileId: string) => Promise<CodingAgentConfigOptionsResult>;
  getProfileAvailableCommands: (profileId: string) => Promise<CodingAgentCommandsResult>;
  createSession: (
    input: import('../../../shared/codingAgent').CreateCodingSessionInput,
  ) => Promise<CodingAgentActionResult>;
  startSession: (
    input: import('../../../shared/codingAgent').StartCodingSessionInput,
  ) => Promise<CodingAgentActionResult>;
  bootstrap: (workspaceRoot: string) => Promise<CodingAgentActionResult>;
  prepareLane: (input: {
    workspaceRoot: string;
    laneId: string;
  }) => Promise<CodingAgentActionResult>;
  createMission: (
    input: import('../../../shared/codingAgent').CreateCodingMissionInput,
  ) => Promise<CodingAgentActionResult>;
  selectLane: (input: {
    workspaceRoot: string;
    laneId: string;
  }) => Promise<CodingAgentActionResult>;
  prompt: (input: {
    workspaceRoot: string;
    prompt: import('../../../shared/codingAgent').CodingPromptInput;
  }) => Promise<CodingAgentActionResult>;
  listPendingMessages: (laneId: string) => Promise<{
    success: boolean;
    items?: import('../../../shared/cowork/pendingMessageQueue').CoworkPendingMessage[];
    error?: string;
  }>;
  enqueuePendingMessage: (input: { laneId: string; text: string }) => Promise<{
    success: boolean;
    item?: import('../../../shared/cowork/pendingMessageQueue').CoworkPendingMessage;
    error?: string;
  }>;
  updatePendingMessage: (input: {
    laneId: string;
    itemId: string;
    text: string;
  }) => Promise<{ success: boolean; error?: string }>;
  deletePendingMessage: (input: {
    laneId: string;
    itemId: string;
  }) => Promise<{ success: boolean; error?: string }>;
  steerPendingMessage: (input: {
    workspaceRoot: string;
    laneId: string;
    itemId: string;
  }) => Promise<CodingAgentActionResult>;
  followUpPendingMessage: (input: {
    workspaceRoot: string;
    laneId: string;
    itemId: string;
  }) => Promise<CodingAgentActionResult>;
  confirmSessionRecovery: (input: {
    workspaceRoot: string;
    laneId: string;
    includeRecoveryContext: boolean;
  }) => Promise<CodingAgentActionResult>;
  cancel: (input: { workspaceRoot: string; laneId: string }) => Promise<CodingAgentActionResult>;
  respondElicitation: (input: {
    workspaceRoot: string;
    response: import('../../../shared/codingAgent').CodingElicitationResponse;
  }) => Promise<CodingAgentActionResult>;
  cancelElicitation: (input: {
    workspaceRoot: string;
    requestId: string;
  }) => Promise<CodingAgentActionResult>;
  previewHandoff: (input: {
    workspaceRoot: string;
    sourceLaneId: string;
    targetLaneId: string;
  }) => Promise<CodingHandoffPreviewResult>;
  handoff: (input: {
    workspaceRoot: string;
    sourceLaneId: string;
    targetLaneId: string;
  }) => Promise<CodingAgentActionResult>;
  addLane: (input: {
    workspaceRoot: string;
    missionId: string;
    profileId: string;
  }) => Promise<CodingAgentActionResult>;
  createCollaborationPreset: (
    input: import('../../../shared/codingAgent').CreateCodingCollaborationPresetInput,
  ) => Promise<CodingAgentActionResult>;
  saveLaneView: (input: {
    workspaceRoot: string;
    view: import('../../../shared/codingAgent').CodingLaneViewStateInput;
  }) => Promise<CodingAgentActionResult>;
  setLaneConfigOption: (input: {
    workspaceRoot: string;
    option: import('../../../shared/codingAgent').CodingLaneConfigOptionInput;
  }) => Promise<CodingAgentActionResult>;
  setLaneModelOverride: (input: {
    workspaceRoot: string;
    laneId: string;
    modelOverride: string | null;
  }) => Promise<CodingAgentActionResult>;
  previewLaneChanges: (input: {
    workspaceRoot: string;
    laneId: string;
  }) => Promise<CodingLaneChangePreviewResult>;
  applyLaneChanges: (input: {
    workspaceRoot: string;
    laneId: string;
  }) => Promise<CodingAgentActionResult>;
  getGitStatus: (
    input: import('../../../shared/codingAgent').CodingGitTargetInput,
  ) => Promise<CodingGitStatusResult>;
  getGitDiff: (
    input: import('../../../shared/codingAgent').CodingGitDiffInput,
  ) => Promise<CodingGitDiffResult>;
  stageGitPaths: (
    input: import('../../../shared/codingAgent').CodingGitPathActionInput,
  ) => Promise<CodingGitStatusResult>;
  unstageGitPaths: (
    input: import('../../../shared/codingAgent').CodingGitPathActionInput,
  ) => Promise<CodingGitStatusResult>;
  commitGitChanges: (
    input: import('../../../shared/codingAgent').CodingGitCommitInput,
  ) => Promise<CodingGitStatusResult>;
  commitAndPushGitChanges: (
    input: import('../../../shared/codingAgent').CodingGitCommitAndPushInput,
  ) => Promise<CodingGitCommitAndPushActionResult>;
  pushGitBranch: (
    input: import('../../../shared/codingAgent').CodingGitTargetInput,
  ) => Promise<CodingGitStatusResult>;
  switchGitBranch: (
    input: import('../../../shared/codingAgent').CodingGitBranchInput,
  ) => Promise<CodingGitStatusResult>;
  createGitBranch: (
    input: import('../../../shared/codingAgent').CodingGitBranchInput,
  ) => Promise<CodingGitStatusResult>;
  createGitPullRequest: (
    input: import('../../../shared/codingAgent').CodingGitPullRequestInput,
  ) => Promise<{ success: boolean; url?: string; error?: string }>;
  listWorkspaceFiles: (
    input: import('../../../shared/codingAgent').CodingWorkspaceFileInput,
  ) => Promise<{
    success: boolean;
    entries?: import('../../../shared/codingAgent').CodingWorkspaceFileEntry[];
    error?: string;
  }>;
  readWorkspaceFile: (
    input: import('../../../shared/codingAgent').CodingWorkspaceFileInput,
  ) => Promise<{
    success: boolean;
    file?: import('../../../shared/codingAgent').CodingWorkspaceFileContent;
    error?: string;
  }>;
  writeWorkspaceFile: (
    input: import('../../../shared/codingAgent').CodingWorkspaceFileWriteInput,
  ) => Promise<{
    success: boolean;
    file?: import('../../../shared/codingAgent').CodingWorkspaceFileContent;
    error?: string;
  }>;
  discoverAgents: (input: { workspaceRoot: string }) => Promise<CodingAgentActionResult>;
  probeAgent: (input: {
    workspaceRoot: string;
    profileId: string;
  }) => Promise<CodingAgentActionResult>;
  addProfile: (input: {
    workspaceRoot: string;
    profile: import('../../../shared/codingAgent').AddCodingAgentProfileInput;
  }) => Promise<CodingAgentActionResult>;
  trustProfile: (input: {
    workspaceRoot: string;
    profileId: string;
  }) => Promise<CodingAgentActionResult>;
  authenticateProfile: (input: {
    workspaceRoot: string;
    profileId: string;
    methodId: string;
  }) => Promise<CodingAgentActionResult>;
  startAuthTerminal: (input: {
    workspaceRoot: string;
    profileId: string;
    methodId: string;
  }) => Promise<{
    success: boolean;
    terminal?: { id: string; profileId: string; methodId: string };
    error?: string;
  }>;
  writeAuthTerminal: (input: { id: string; data: string }) => Promise<CodingAgentActionResult>;
  resizeAuthTerminal: (input: {
    id: string;
    columns: number;
    rows: number;
  }) => Promise<CodingAgentActionResult>;
  cancelAuthTerminal: (id: string) => Promise<CodingAgentActionResult>;
  respondPermission: (input: {
    workspaceRoot: string;
    response: import('../../../shared/codingAgent').CodingPermissionResponse;
  }) => Promise<CodingAgentActionResult>;
  onChanged: (
    callback: (snapshot: import('../../../shared/codingAgent').CodingRoomSnapshot) => void,
  ) => () => void;
  onEventDelta: (
    callback: (delta: import('../../../shared/codingAgent').CodingRoomEventDelta) => void,
  ) => () => void;
  loadEventPage: (input: {
    workspaceRoot: string;
    laneId: string;
    beforeSequence: number | null;
  }) => Promise<{
    success: boolean;
    page?: import('../../../shared/codingAgent').CodingEventPage;
    error?: string;
  }>;
  onPendingMessagesChanged: (
    callback: (
      event: import('../../../shared/codingAgent').CodingPendingMessagesChangedEvent,
    ) => void,
  ) => () => void;
  onAuthTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void;
  onAuthTerminalExit: (
    callback: (event: {
      id: string;
      profileId: string;
      methodId: string;
      exitCode: number;
      signal?: number;
    }) => void,
  ) => () => void;
}
