import type {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingAssignmentStatus,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
  CodingPermissionOutcome,
} from './constants';

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
  isBuiltin: boolean;
}

export interface CodingRoom {
  id: string;
  workspaceRoot: string;
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
  executionRoot: string;
  configOptions: CodingAgentConfigOption[];
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

export interface CreateCodingMissionInput {
  workspaceRoot: string;
  profileId: string;
  title?: string;
}

export interface CodingPromptInput {
  laneId: string;
  prompt: string;
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
