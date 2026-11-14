export const WorkbenchExecutionStatus = {
  Queued: 'queued',
  Running: 'running',
  Settled: 'settled',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type WorkbenchExecutionStatus =
  (typeof WorkbenchExecutionStatus)[keyof typeof WorkbenchExecutionStatus];

export const WorkbenchRunTrigger = {
  Message: 'message',
  Retry: 'retry',
  Resume: 'resume',
} as const;
export type WorkbenchRunTrigger = (typeof WorkbenchRunTrigger)[keyof typeof WorkbenchRunTrigger];

export const WorkbenchContractKind = {
  Chat: 'chat',
  Research: 'research',
  Shortcut: 'shortcut',
  GenericWork: 'generic_work',
} as const;
export type WorkbenchContractKind =
  (typeof WorkbenchContractKind)[keyof typeof WorkbenchContractKind];

export const WorkbenchApprovalRiskLevel = {
  ReadOnly: 'read_only',
  Reversible: 'reversible',
  Irreversible: 'irreversible',
  Unknown: 'unknown',
} as const;
export type WorkbenchApprovalRiskLevel =
  (typeof WorkbenchApprovalRiskLevel)[keyof typeof WorkbenchApprovalRiskLevel];

export const WorkbenchApprovalMode = {
  Ask: 'ask',
  Auto: 'auto',
  AllowAll: 'allowAll',
} as const;
export type WorkbenchApprovalMode =
  (typeof WorkbenchApprovalMode)[keyof typeof WorkbenchApprovalMode];

export const WorkbenchApprovalDecision = {
  Pending: 'pending',
  Approved: 'approved',
  Denied: 'denied',
  Expired: 'expired',
} as const;
export type WorkbenchApprovalDecision =
  (typeof WorkbenchApprovalDecision)[keyof typeof WorkbenchApprovalDecision];

export const WorkbenchApprovalDecisionSource = {
  User: 'user',
  Policy: 'policy',
  Recovery: 'recovery',
} as const;
export type WorkbenchApprovalDecisionSource =
  (typeof WorkbenchApprovalDecisionSource)[keyof typeof WorkbenchApprovalDecisionSource];

export const WorkbenchApprovalEffectStatus = {
  NotStarted: 'not_started',
  Executing: 'executing',
  Succeeded: 'succeeded',
  Failed: 'failed',
  NeedsReview: 'needs_review',
} as const;
export type WorkbenchApprovalEffectStatus =
  (typeof WorkbenchApprovalEffectStatus)[keyof typeof WorkbenchApprovalEffectStatus];

export const WorkbenchArtifactKind = {
  File: 'file',
  MessageBlock: 'message_block',
  Evidence: 'evidence',
} as const;
export type WorkbenchArtifactKind =
  (typeof WorkbenchArtifactKind)[keyof typeof WorkbenchArtifactKind];

export const WorkbenchArtifactProvenance = {
  Workspace: 'workspace',
  Message: 'message',
  Controller: 'controller',
  External: 'external',
} as const;
export type WorkbenchArtifactProvenance =
  (typeof WorkbenchArtifactProvenance)[keyof typeof WorkbenchArtifactProvenance];

export const WorkbenchArtifactCandidateSource = {
  Declaration: 'declaration',
  ToolEffect: 'tool_effect',
  DomainWorkflow: 'domain_workflow',
} as const;
export type WorkbenchArtifactCandidateSource =
  (typeof WorkbenchArtifactCandidateSource)[keyof typeof WorkbenchArtifactCandidateSource];

export const WorkbenchArtifactVerificationStatus = {
  Pending: 'pending',
  Verified: 'verified',
  Failed: 'failed',
} as const;
export type WorkbenchArtifactVerificationStatus =
  (typeof WorkbenchArtifactVerificationStatus)[keyof typeof WorkbenchArtifactVerificationStatus];

export const WorkbenchRunEventType = {
  RunCreated: 'run_created',
  RunStarted: 'run_started',
  ToolRead: 'tool_read',
  ApprovalRequested: 'approval_requested',
  ApprovalResolved: 'approval_resolved',
  ToolEffectStarted: 'tool_effect_started',
  ToolEffectFinished: 'tool_effect_finished',
  RunSettled: 'run_settled',
  RunCancelled: 'run_cancelled',
  RunFailed: 'run_failed',
  HarnessProfiled: 'harness_profiled',
  HarnessActivation: 'harness_activation',
  HarnessFailure: 'harness_failure',
  HarnessQualityMeasured: 'harness_quality_measured',
  ArtifactRegistered: 'artifact_registered',
} as const;
export type WorkbenchRunEventType =
  (typeof WorkbenchRunEventType)[keyof typeof WorkbenchRunEventType];

export const WorkbenchTaskIpc = {
  GetCurrent: 'workbenchTask:getCurrent',
  GetDetail: 'workbenchTask:getDetail',
  ListForSession: 'workbenchTask:listForSession',
  ExportAudit: 'workbenchTask:exportAudit',
  Changed: 'workbenchTask:changed',
} as const;
export type WorkbenchTaskIpc = (typeof WorkbenchTaskIpc)[keyof typeof WorkbenchTaskIpc];

export const WorkbenchTerminalExecutionStatuses = [
  WorkbenchExecutionStatus.Settled,
  WorkbenchExecutionStatus.Failed,
  WorkbenchExecutionStatus.Cancelled,
] as const;
