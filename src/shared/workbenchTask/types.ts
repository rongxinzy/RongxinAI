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
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
  WorkbenchVerificationCheckStatus,
  WorkbenchVerificationOutcome,
} from './constants';

export type WorkbenchJsonObject = Record<string, unknown>;

export interface WorkbenchTaskContract {
  kind: WorkbenchContractKind;
  requiresUserAcceptance: boolean;
  metadata?: WorkbenchJsonObject;
}

export interface WorkbenchVerificationCheck {
  name: string;
  status: WorkbenchVerificationCheckStatus;
  detail?: string;
}

export interface WorkbenchVerificationResult {
  outcome: WorkbenchVerificationOutcome;
  checks: WorkbenchVerificationCheck[];
  evidence: WorkbenchJsonObject[];
  summary: string;
}

export interface WorkbenchTask {
  id: string;
  sessionId: string;
  goal: string;
  status: WorkbenchTaskStatus;
  contract: WorkbenchTaskContract;
  activeRunId: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface WorkbenchRun {
  id: string;
  taskId: string;
  attempt: number;
  status: WorkbenchRunStatus;
  trigger: WorkbenchRunTrigger;
  startedAt: number | null;
  endedAt: number | null;
  verificationResult: WorkbenchVerificationResult | null;
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

export interface WorkbenchApprovalResponseInput {
  approvalId: string;
  approved: boolean;
  reason?: string;
}
