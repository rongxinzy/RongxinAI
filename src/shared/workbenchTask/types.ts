import type {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalRiskLevel,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchExecutionStatus,
  WorkbenchRunTrigger,
} from './constants';

export type WorkbenchJsonObject = Record<string, unknown>;

export interface WorkbenchTaskContract {
  kind: WorkbenchContractKind;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchTask {
  id: string;
  sessionId: string;
  goal: string;
  status: WorkbenchExecutionStatus;
  contract: WorkbenchTaskContract;
  activeRunId: string | null;
  createdAt: number;
  updatedAt: number;
  endedAt: number | null;
}

export interface WorkbenchRunContext {
  model: string;
  provider: string;
  reasoningProfile: string;
  workspaceRoot: string;
  skillIds: string[];
}

export interface WorkbenchRun {
  id: string;
  taskId: string;
  attempt: number;
  status: WorkbenchExecutionStatus;
  trigger: WorkbenchRunTrigger;
  startedAt: number | null;
  endedAt: number | null;
  context: WorkbenchRunContext | null;
  failure: WorkbenchJsonObject | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkbenchRunEvent {
  id: string;
  runId: string;
  sequence: number;
  type: WorkbenchRunEventType;
  payload: WorkbenchJsonObject;
  createdAt: number;
}

export interface WorkbenchArtifact {
  id: string;
  taskId: string;
  runId: string;
  kind: WorkbenchArtifactKind;
  mimeType: string;
  reference: string;
  contentHash: string;
  provenance: WorkbenchArtifactProvenance;
  verificationStatus: WorkbenchArtifactVerificationStatus;
  metadata: WorkbenchJsonObject;
  createdAt: number;
  updatedAt: number;
}

export interface WorkbenchApproval {
  id: string;
  taskId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  riskLevel: WorkbenchApprovalRiskLevel;
  decision: WorkbenchApprovalDecision;
  decisionSource: WorkbenchApprovalDecisionSource | null;
  effectStatus: WorkbenchApprovalEffectStatus;
  idempotencyKey: string;
  request: WorkbenchJsonObject;
  result: WorkbenchJsonObject | null;
  createdAt: number;
  updatedAt: number;
  decidedAt: number | null;
}

export interface WorkbenchTaskDetail {
  task: WorkbenchTask;
  runs: WorkbenchRun[];
  events: WorkbenchRunEvent[];
  artifacts: WorkbenchArtifact[];
  approvals: WorkbenchApproval[];
}

export interface WorkbenchTaskChangedEvent {
  sessionId: string;
  taskId: string;
}

export interface WorkbenchTaskActionResult {
  success: boolean;
  detail?: WorkbenchTaskDetail;
  error?: string;
}

export interface WorkbenchTaskListResult {
  success: boolean;
  tasks?: WorkbenchTask[];
  error?: string;
}

export interface WorkbenchTaskExportResult {
  success: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}
