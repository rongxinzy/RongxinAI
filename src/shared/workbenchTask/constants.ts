export const WorkbenchTaskStatus = {
  Draft: 'draft',
  Planned: 'planned',
  Running: 'running',
  Paused: 'paused',
  NeedsReview: 'needs_review',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type WorkbenchTaskStatus = (typeof WorkbenchTaskStatus)[keyof typeof WorkbenchTaskStatus];

export const WorkbenchRunStatus = {
  Queued: 'queued',
  Running: 'running',
  WaitingApproval: 'waiting_approval',
  Verifying: 'verifying',
  Paused: 'paused',
  NeedsReview: 'needs_review',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type WorkbenchRunStatus = (typeof WorkbenchRunStatus)[keyof typeof WorkbenchRunStatus];

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

export const WorkbenchVerificationOutcome = {
  Passed: 'passed',
  Failed: 'failed',
  AcceptanceRequired: 'acceptance_required',
} as const;
export type WorkbenchVerificationOutcome =
  (typeof WorkbenchVerificationOutcome)[keyof typeof WorkbenchVerificationOutcome];

export const WorkbenchVerificationCheckStatus = {
  Passed: 'passed',
  Failed: 'failed',
  Skipped: 'skipped',
} as const;
export type WorkbenchVerificationCheckStatus =
  (typeof WorkbenchVerificationCheckStatus)[keyof typeof WorkbenchVerificationCheckStatus];

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
} as const;
export type WorkbenchArtifactProvenance =
  (typeof WorkbenchArtifactProvenance)[keyof typeof WorkbenchArtifactProvenance];

export const WorkbenchArtifactCandidateSource = {
  Declaration: 'declaration',
  ToolEffect: 'tool_effect',
  DomainWorkflow: 'domain_workflow',
  ProductionInspection: 'production_inspection',
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
  VerificationStarted: 'verification_started',
  VerificationFinished: 'verification_finished',
  RunPaused: 'run_paused',
  RunCancelled: 'run_cancelled',
  RunFailed: 'run_failed',
  RecoveryRequired: 'recovery_required',
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
  Resume: 'workbenchTask:resume',
  Retry: 'workbenchTask:retry',
  Accept: 'workbenchTask:accept',
  RespondToApproval: 'workbenchTask:respondToApproval',
  Changed: 'workbenchTask:changed',
} as const;
export type WorkbenchTaskIpc = (typeof WorkbenchTaskIpc)[keyof typeof WorkbenchTaskIpc];

export const WorkbenchTerminalTaskStatuses = [
  WorkbenchTaskStatus.Completed,
  WorkbenchTaskStatus.Failed,
  WorkbenchTaskStatus.Cancelled,
] as const;
