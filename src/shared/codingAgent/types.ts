import type {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingAssignmentStatus,
  CodingEventKind,
  CodingGitDiffScope,
  CodingGitFileStatus,
  CodingLaneStatus,
  CodingMissionStatus,
  CodingPermissionOutcome,
  CodingWorkflowStage,
} from './constants';
import { CoworkQueueDelivery } from '../cowork/pendingMessageQueue';

export interface CodingAgentCapabilities {
  supportsLoadSession: boolean;
  supportsResumeSession: boolean;
  supportsPlans: boolean;
  supportsPermissions: boolean;
  supportsFilesystem: boolean;
  supportsTerminal: boolean;
  supportsConfigOptions: boolean;
  supportsUsage: boolean;
  supportsElicitation: boolean;
}

/** Advertised by ACP during probing; credentials themselves are never stored. */
export interface CodingAgentAuthMethod {
  id: string;
  name: string;
  description?: string;
  type?: string;
  args?: string[];
  environment?: Record<string, string>;
}

export interface CodingAgentConfigOptionValue {
  value: string;
  name: string;
  description?: string;
}

export interface CodingAgentConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: 'select' | 'boolean';
  currentValue: string | boolean;
  options?: CodingAgentConfigOptionValue[];
}

export interface CodingAgentAvailableCommandInput {
  hint: string;
}

/** Full ACP command snapshot advertised for one Agent session. */
export interface CodingAgentAvailableCommand {
  name: string;
  description: string;
  input?: CodingAgentAvailableCommandInput | null;
  _meta?: Record<string, unknown> | null;
}

export interface CodingAgentProfile {
  id: string;
  name: string;
  description: string;
  driverKind: CodingAgentDriverKind;
  status: CodingAgentProfileStatus;
  capabilities: CodingAgentCapabilities;
  authMethods: CodingAgentAuthMethod[];
  command: string | null;
  args: string[];
  environment: Record<string, string>;
  isBuiltin: boolean;
}

export interface CodingRoom {
  id: string;
  name: string;
  workspaceRoot: string;
  defaultProfileId: string;
  activeMissionId: string | null;
  activeLaneId: string | null;
}

export interface CodingMission {
  id: string;
  roomId: string;
  title: string;
  goal: string;
  /** Immutable Git revision captured when this mission was created, when applicable. */
  gitBaseline: string | null;
  status: CodingMissionStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CodingAgentLane {
  id: string;
  missionId: string;
  profileId: string;
  /** Explicit provider/model reference for the built-in agent, when selected. */
  modelOverride: string | null;
  /** Immutable source folder selected when this Agent session was created. */
  sourceRoot: string;
  /** Actual cwd. Collaborators use an isolated worktree derived from sourceRoot. */
  executionRoot: string;
  configOptions: CodingAgentConfigOption[];
  availableCommands: CodingAgentAvailableCommand[];
  localSessionId: string;
  remoteSessionId: string | null;
  status: CodingLaneStatus;
  draft: string;
  scrollPosition: number;
  pendingRecoveryPrompt: string | null;
  pendingRecoveryContext: string | null;
}

export interface CodingAssignment {
  id: string;
  missionId: string;
  laneId: string;
  title: string;
  instructions: string;
  workflowStage: CodingWorkflowStage | null;
  previousAssignmentId: string | null;
  status: CodingAssignmentStatus;
  workbenchTaskId: string | null;
  workbenchRunId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CodingEvent {
  id: string;
  laneId: string;
  sequence: number;
  kind: CodingEventKind;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface CodingPermissionResponse {
  requestId: string;
  outcome: CodingPermissionOutcome;
  optionId?: string;
}

export interface CodingWorkspaceLease {
  roomId: string;
  sourceRoot: string;
  laneId: string | null;
  acquiredAt: number | null;
}

export interface CodingHandoffPackage {
  id: string;
  missionId: string;
  sourceLaneId: string;
  targetLaneId: string;
  content: Record<string, unknown>;
  createdAt: number;
}

export interface CodingRoomSnapshot {
  room: CodingRoom;
  profiles: CodingAgentProfile[];
  missions: CodingMission[];
  lanes: CodingAgentLane[];
  assignments: CodingAssignment[];
  events: CodingEvent[];
}

export interface CodingPendingMessagesChangedEvent {
  laneId: string;
  items: import('../cowork/pendingMessageQueue').CoworkPendingMessage[];
}

/** Coding lanes use the same in-process delivery semantics as Work sessions. */
export const CodingPromptDelivery = CoworkQueueDelivery;
export type CodingPromptDelivery = CoworkQueueDelivery;

export interface CodingWorkspaceSource {
  id: string;
  workspaceId: string;
  path: string;
  isPrimary: boolean;
}

export interface CodingSessionSummary {
  id: string;
  workspaceId: string;
  missionId: string;
  parentSessionId: string | null;
  title: string;
  profileId: string;
  sourceRoot: string;
  status: CodingLaneStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CodingWorkspaceSummary {
  id: string;
  name: string;
  primaryRoot: string;
  defaultProfileId: string;
  sources: CodingWorkspaceSource[];
  sessions: CodingSessionSummary[];
  activeSessionId: string | null;
}

export interface CreateCodingWorkspaceInput {
  name: string;
  sourceFolders: string[];
  defaultProfileId: string;
}

export interface UpdateCodingWorkspaceInput extends CreateCodingWorkspaceInput {
  workspaceId: string;
}

export interface CreateCodingSessionInput {
  workspaceId: string;
  profileId: string;
  sourceRoot: string;
  title?: string;
  modelOverride?: string;
}

export interface StartCodingSessionInput extends CreateCodingSessionInput {
  prompt: string;
  /** Config option values chosen in the draft composer, applied at creation. */
  configOptionOverrides?: Record<string, string>;
}

export interface CreateCodingMissionInput {
  workspaceRoot: string;
  profileId: string;
  title?: string;
}

export interface CodingPromptInput {
  laneId: string;
  prompt: string;
  delivery?: CodingPromptDelivery;
}

export interface CodingLaneViewStateInput {
  laneId: string;
  draft: string;
  scrollPosition: number;
}

export interface CodingLaneConfigOptionInput {
  laneId: string;
  configId: string;
  value: string | boolean;
}

export interface CodingLaneChangePreview {
  laneId: string;
  diff: string;
}

export interface CodingGitTargetInput {
  workspaceRoot: string;
  laneId?: string;
  sourceRoot?: string;
}

export interface CodingGitFileChange {
  path: string;
  originalPath?: string;
  indexStatus: CodingGitFileStatus | null;
  worktreeStatus: CodingGitFileStatus | null;
  additions: number | null;
  deletions: number | null;
}

export interface CodingGitStatus {
  isRepository: boolean;
  targetRoot: string;
  repositoryRoot: string | null;
  branch: string | null;
  head: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  additions: number;
  deletions: number;
  files: CodingGitFileChange[];
  isIsolated: boolean;
  isBusy: boolean;
  canMutate: boolean;
}

export interface CodingGitDiffInput extends CodingGitTargetInput {
  path: string;
  scope: CodingGitDiffScope;
}

export interface CodingGitPathActionInput extends CodingGitTargetInput {
  paths: string[];
}

export interface CodingGitCommitInput extends CodingGitTargetInput {
  message: string;
}

export interface CreateCodingCollaborationPresetInput {
  workspaceRoot: string;
  missionId: string;
  reviewerProfileId: string;
  verifierProfileId: string;
}

export interface AddCodingAgentProfileInput {
  name: string;
  description: string;
  command: string;
  args: string[];
}
