export const CodingAgentDriverKind = {
  Builtin: 'builtin',
  Acp: 'acp',
} as const;
export type CodingAgentDriverKind =
  (typeof CodingAgentDriverKind)[keyof typeof CodingAgentDriverKind];

export const CodingAgentProfileStatus = {
  Detected: 'detected',
  Ready: 'ready',
  NeedsAdapter: 'needs_adapter',
  NeedsConfiguration: 'needs_configuration',
  NeedsAuth: 'needs_auth',
  Incompatible: 'incompatible',
  Untrusted: 'untrusted',
  Unavailable: 'unavailable',
} as const;
export type CodingAgentProfileStatus =
  (typeof CodingAgentProfileStatus)[keyof typeof CodingAgentProfileStatus];

export const CodingAgentProfileId = {
  Builtin: 'builtin-zhiyuan-coding',
} as const;
export type CodingAgentProfileId = (typeof CodingAgentProfileId)[keyof typeof CodingAgentProfileId];

export const CodingAgentEnvironmentKey = {
  ElectronRunAsNode: 'ELECTRON_RUN_AS_NODE',
  ManagedAdapterId: 'ZHIYUAN_ACP_ADAPTER_ID',
  ManagedAdapterVersion: 'ZHIYUAN_ACP_ADAPTER_VERSION',
  CodexPath: 'CODEX_PATH',
  ClaudeCodeExecutable: 'CLAUDE_CODE_EXECUTABLE',
} as const;
export type CodingAgentEnvironmentKey =
  (typeof CodingAgentEnvironmentKey)[keyof typeof CodingAgentEnvironmentKey];

export const CodingAgentManagedAdapterId = {
  Codex: 'codex',
  ClaudeCode: 'claude-code',
} as const;
export type CodingAgentManagedAdapterId =
  (typeof CodingAgentManagedAdapterId)[keyof typeof CodingAgentManagedAdapterId];

export const CodingMissionStatus = {
  Draft: 'draft',
  Running: 'running',
  WaitingApproval: 'waiting_approval',
  NeedsReview: 'needs_review',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type CodingMissionStatus = (typeof CodingMissionStatus)[keyof typeof CodingMissionStatus];

export const CodingAssignmentStatus = {
  Planned: 'planned',
  Running: 'running',
  WaitingApproval: 'waiting_approval',
  NeedsReview: 'needs_review',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type CodingAssignmentStatus =
  (typeof CodingAssignmentStatus)[keyof typeof CodingAssignmentStatus];

export const CodingWorkflowStage = {
  Implementation: 'implementation',
  Review: 'review',
  Verification: 'verification',
} as const;
export type CodingWorkflowStage = (typeof CodingWorkflowStage)[keyof typeof CodingWorkflowStage];

export const CodingLaneStatus = {
  Idle: 'idle',
  Running: 'running',
  WaitingApproval: 'waiting_approval',
  NeedsAuth: 'needs_auth',
  Disconnected: 'disconnected',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type CodingLaneStatus = (typeof CodingLaneStatus)[keyof typeof CodingLaneStatus];

export const CodingEventKind = {
  Message: 'message',
  MessageDelta: 'message_delta',
  Reasoning: 'reasoning',
  Plan: 'plan',
  ToolCall: 'tool_call',
  Permission: 'permission',
  FileChange: 'file_change',
  Terminal: 'terminal',
  Usage: 'usage',
  TurnComplete: 'turn_complete',
  TurnCancelled: 'turn_cancelled',
  TurnFailed: 'turn_failed',
} as const;
export type CodingEventKind = (typeof CodingEventKind)[keyof typeof CodingEventKind];

export const CodingStreamUpdateMode = {
  Append: 'append',
  Replace: 'replace',
} as const;
export type CodingStreamUpdateMode =
  (typeof CodingStreamUpdateMode)[keyof typeof CodingStreamUpdateMode];

export const CodingToolCallStatus = {
  Pending: 'pending',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type CodingToolCallStatus = (typeof CodingToolCallStatus)[keyof typeof CodingToolCallStatus];

export const CodingPermissionOutcome = {
  Selected: 'selected',
  Cancelled: 'cancelled',
} as const;
export type CodingPermissionOutcome =
  (typeof CodingPermissionOutcome)[keyof typeof CodingPermissionOutcome];

export const CodingGitFileStatus = {
  Added: 'added',
  Modified: 'modified',
  Deleted: 'deleted',
  Renamed: 'renamed',
  Copied: 'copied',
  Untracked: 'untracked',
  Conflicted: 'conflicted',
  TypeChanged: 'type_changed',
} as const;
export type CodingGitFileStatus = (typeof CodingGitFileStatus)[keyof typeof CodingGitFileStatus];

export const CodingGitDiffScope = {
  Staged: 'staged',
  Unstaged: 'unstaged',
  Untracked: 'untracked',
} as const;
export type CodingGitDiffScope = (typeof CodingGitDiffScope)[keyof typeof CodingGitDiffScope];

export const CodingAgentIpc = {
  ListProfiles: 'codingAgent:listProfiles',
  ListWorkspaces: 'codingAgent:listWorkspaces',
  CreateWorkspace: 'codingAgent:createWorkspace',
  UpdateWorkspace: 'codingAgent:updateWorkspace',
  DeleteWorkspace: 'codingAgent:deleteWorkspace',
  DeleteSession: 'codingAgent:deleteSession',
  GetProfileConfigOptions: 'codingAgent:getProfileConfigOptions',
  CreateSession: 'codingAgent:createSession',
  StartSession: 'codingAgent:startSession',
  Bootstrap: 'codingAgent:bootstrap',
  PrepareLane: 'codingAgent:prepareLane',
  CreateMission: 'codingAgent:createMission',
  SelectLane: 'codingAgent:selectLane',
  Prompt: 'codingAgent:prompt',
  ListPendingMessages: 'codingAgent:listPendingMessages',
  EnqueuePendingMessage: 'codingAgent:enqueuePendingMessage',
  UpdatePendingMessage: 'codingAgent:updatePendingMessage',
  DeletePendingMessage: 'codingAgent:deletePendingMessage',
  SteerPendingMessage: 'codingAgent:steerPendingMessage',
  FollowUpPendingMessage: 'codingAgent:followUpPendingMessage',
  PendingMessagesChanged: 'codingAgent:pendingMessagesChanged',
  ConfirmSessionRecovery: 'codingAgent:confirmSessionRecovery',
  Cancel: 'codingAgent:cancel',
  PreviewHandoff: 'codingAgent:previewHandoff',
  Handoff: 'codingAgent:handoff',
  AddLane: 'codingAgent:addLane',
  CreateCollaborationPreset: 'codingAgent:createCollaborationPreset',
  SaveLaneView: 'codingAgent:saveLaneView',
  SetLaneConfigOption: 'codingAgent:setLaneConfigOption',
  SetLaneModelOverride: 'codingAgent:setLaneModelOverride',
  PreviewLaneChanges: 'codingAgent:previewLaneChanges',
  ApplyLaneChanges: 'codingAgent:applyLaneChanges',
  GetGitStatus: 'codingAgent:getGitStatus',
  GetGitDiff: 'codingAgent:getGitDiff',
  StageGitPaths: 'codingAgent:stageGitPaths',
  UnstageGitPaths: 'codingAgent:unstageGitPaths',
  CommitGitChanges: 'codingAgent:commitGitChanges',
  PushGitBranch: 'codingAgent:pushGitBranch',
  DiscoverAgents: 'codingAgent:discoverAgents',
  ProbeAgent: 'codingAgent:probeAgent',
  AddProfile: 'codingAgent:addProfile',
  TrustProfile: 'codingAgent:trustProfile',
  AuthenticateProfile: 'codingAgent:authenticateProfile',
  StartAuthTerminal: 'codingAgent:startAuthTerminal',
  WriteAuthTerminal: 'codingAgent:writeAuthTerminal',
  ResizeAuthTerminal: 'codingAgent:resizeAuthTerminal',
  CancelAuthTerminal: 'codingAgent:cancelAuthTerminal',
  RespondPermission: 'codingAgent:respondPermission',
  Changed: 'codingAgent:changed',
  AuthTerminalData: 'codingAgent:authTerminalData',
  AuthTerminalExit: 'codingAgent:authTerminalExit',
} as const;
export type CodingAgentIpc = (typeof CodingAgentIpc)[keyof typeof CodingAgentIpc];
