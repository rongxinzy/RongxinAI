import {
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
  type WorkbenchRun,
  type WorkbenchTaskDetail,
} from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { WorkbenchTaskRunFilter } from './constants';

const statusTranslationKeys: Record<string, string> = {
  [WorkbenchTaskStatus.Draft]: 'workbenchTaskStatusDraft',
  [WorkbenchTaskStatus.Planned]: 'workbenchTaskStatusPlanned',
  [WorkbenchTaskStatus.Running]: 'workbenchTaskStatusRunning',
  [WorkbenchTaskStatus.Paused]: 'workbenchTaskStatusPaused',
  [WorkbenchTaskStatus.NeedsReview]: 'workbenchTaskStatusNeedsReview',
  [WorkbenchTaskStatus.Completed]: 'workbenchTaskStatusCompleted',
  [WorkbenchTaskStatus.Failed]: 'workbenchTaskStatusFailed',
  [WorkbenchTaskStatus.Cancelled]: 'workbenchTaskStatusCancelled',
  [WorkbenchRunStatus.Queued]: 'workbenchTaskStatusQueued',
  [WorkbenchRunStatus.WaitingApproval]: 'workbenchTaskStatusWaitingApproval',
  [WorkbenchRunStatus.Verifying]: 'workbenchTaskStatusVerifying',
  [WorkbenchRunStatus.Succeeded]: 'workbenchTaskStatusSucceeded',
};

const triggerTranslationKeys: Record<string, string> = {
  [WorkbenchRunTrigger.Message]: 'workbenchTaskTriggerMessage',
  [WorkbenchRunTrigger.Retry]: 'workbenchTaskTriggerRetry',
  [WorkbenchRunTrigger.Resume]: 'workbenchTaskTriggerResume',
};

const decisionTranslationKeys: Record<string, string> = {
  [WorkbenchApprovalDecision.Pending]: 'workbenchTaskDecisionPending',
  [WorkbenchApprovalDecision.Approved]: 'workbenchTaskDecisionApproved',
  [WorkbenchApprovalDecision.Denied]: 'workbenchTaskDecisionDenied',
  [WorkbenchApprovalDecision.Expired]: 'workbenchTaskDecisionExpired',
};

const decisionSourceTranslationKeys: Record<string, string> = {
  [WorkbenchApprovalDecisionSource.User]: 'workbenchTaskDecisionSourceUser',
  [WorkbenchApprovalDecisionSource.Policy]: 'workbenchTaskDecisionSourcePolicy',
  [WorkbenchApprovalDecisionSource.Recovery]: 'workbenchTaskDecisionSourceRecovery',
};

const riskTranslationKeys: Record<string, string> = {
  [WorkbenchApprovalRiskLevel.ReadOnly]: 'workbenchTaskRiskReadOnly',
  [WorkbenchApprovalRiskLevel.Reversible]: 'workbenchTaskRiskReversible',
  [WorkbenchApprovalRiskLevel.Irreversible]: 'workbenchTaskRiskIrreversible',
  [WorkbenchApprovalRiskLevel.Unknown]: 'workbenchTaskRiskUnknown',
};

const effectTranslationKeys: Record<string, string> = {
  [WorkbenchApprovalEffectStatus.NotStarted]: 'workbenchTaskEffectNotStarted',
  [WorkbenchApprovalEffectStatus.Executing]: 'workbenchTaskEffectExecuting',
  [WorkbenchApprovalEffectStatus.Succeeded]: 'workbenchTaskEffectSucceeded',
  [WorkbenchApprovalEffectStatus.Failed]: 'workbenchTaskEffectFailed',
  [WorkbenchApprovalEffectStatus.NeedsReview]: 'workbenchTaskEffectNeedsReview',
};

const artifactKindTranslationKeys: Record<string, string> = {
  [WorkbenchArtifactKind.File]: 'workbenchTaskArtifactFile',
  [WorkbenchArtifactKind.MessageBlock]: 'workbenchTaskArtifactMessageBlock',
  [WorkbenchArtifactKind.Evidence]: 'workbenchTaskArtifactEvidence',
};

const artifactVerificationTranslationKeys: Record<string, string> = {
  [WorkbenchArtifactVerificationStatus.Pending]: 'workbenchTaskArtifactPending',
  [WorkbenchArtifactVerificationStatus.Verified]: 'workbenchTaskArtifactVerified',
  [WorkbenchArtifactVerificationStatus.Failed]: 'workbenchTaskArtifactFailed',
};

const artifactProvenanceTranslationKeys: Record<string, string> = {
  [WorkbenchArtifactProvenance.Workspace]: 'workbenchTaskProvenanceWorkspace',
  [WorkbenchArtifactProvenance.Message]: 'workbenchTaskProvenanceMessage',
  [WorkbenchArtifactProvenance.Controller]: 'workbenchTaskProvenanceController',
};

const verificationOutcomeTranslationKeys: Record<string, string> = {
  [WorkbenchVerificationOutcome.Passed]: 'workbenchTaskVerificationPassed',
  [WorkbenchVerificationOutcome.Failed]: 'workbenchTaskVerificationFailed',
  [WorkbenchVerificationOutcome.AcceptanceRequired]: 'workbenchTaskVerificationAcceptanceRequired',
};

const verificationCheckTranslationKeys: Record<string, string> = {
  [WorkbenchVerificationCheckStatus.Passed]: 'workbenchTaskCheckPassed',
  [WorkbenchVerificationCheckStatus.Failed]: 'workbenchTaskCheckFailed',
  [WorkbenchVerificationCheckStatus.Skipped]: 'workbenchTaskCheckSkipped',
};

const contractTranslationKeys: Record<string, string> = {
  [WorkbenchContractKind.Chat]: 'workbenchTaskContractChat',
  [WorkbenchContractKind.Research]: 'workbenchTaskContractResearch',
  [WorkbenchContractKind.Shortcut]: 'workbenchTaskContractShortcut',
  [WorkbenchContractKind.GenericWork]: 'workbenchTaskContractGenericWork',
};

const eventTranslationKeys: Record<string, string> = {
  [WorkbenchRunEventType.RunCreated]: 'workbenchTaskEventRunCreated',
  [WorkbenchRunEventType.RunStarted]: 'workbenchTaskEventRunStarted',
  [WorkbenchRunEventType.ToolRead]: 'workbenchTaskEventToolRead',
  [WorkbenchRunEventType.ApprovalRequested]: 'workbenchTaskEventApprovalRequested',
  [WorkbenchRunEventType.ApprovalResolved]: 'workbenchTaskEventApprovalResolved',
  [WorkbenchRunEventType.ToolEffectStarted]: 'workbenchTaskEventToolEffectStarted',
  [WorkbenchRunEventType.ToolEffectFinished]: 'workbenchTaskEventToolEffectFinished',
  [WorkbenchRunEventType.VerificationStarted]: 'workbenchTaskEventVerificationStarted',
  [WorkbenchRunEventType.VerificationFinished]: 'workbenchTaskEventVerificationFinished',
  [WorkbenchRunEventType.RunPaused]: 'workbenchTaskEventRunPaused',
  [WorkbenchRunEventType.RunCancelled]: 'workbenchTaskEventRunCancelled',
  [WorkbenchRunEventType.RunFailed]: 'workbenchTaskEventRunFailed',
  [WorkbenchRunEventType.RecoveryRequired]: 'workbenchTaskEventRecoveryRequired',
  [WorkbenchRunEventType.HarnessProfiled]: 'workbenchTaskEventHarnessProfiled',
  [WorkbenchRunEventType.HarnessActivation]: 'workbenchTaskEventHarnessActivation',
  [WorkbenchRunEventType.HarnessFailure]: 'workbenchTaskEventHarnessFailure',
  [WorkbenchRunEventType.HarnessQualityMeasured]: 'workbenchTaskEventHarnessQualityMeasured',
};

const translated = (keys: Record<string, string>, value: string): string =>
  i18nService.t(keys[value] || value);

export const statusLabel = (value: string): string => translated(statusTranslationKeys, value);
export const triggerLabel = (value: string): string => translated(triggerTranslationKeys, value);
export const decisionLabel = (value: string): string => translated(decisionTranslationKeys, value);
export const decisionSourceLabel = (value: string): string =>
  translated(decisionSourceTranslationKeys, value);
export const riskLabel = (value: string): string => translated(riskTranslationKeys, value);
export const effectLabel = (value: string): string => translated(effectTranslationKeys, value);
export const artifactKindLabel = (value: string): string =>
  translated(artifactKindTranslationKeys, value);
export const artifactVerificationLabel = (value: string): string =>
  translated(artifactVerificationTranslationKeys, value);
export const artifactProvenanceLabel = (value: string): string =>
  translated(artifactProvenanceTranslationKeys, value);
export const verificationOutcomeLabel = (value: string): string =>
  translated(verificationOutcomeTranslationKeys, value);
export const verificationCheckLabel = (value: string): string =>
  translated(verificationCheckTranslationKeys, value);
export const contractLabel = (value: string): string => translated(contractTranslationKeys, value);
export const eventLabel = (value: string): string => translated(eventTranslationKeys, value);

export const statusBadgeVariant = (status: string): 'secondary' | 'outline' | 'destructive' => {
  if (status === WorkbenchTaskStatus.Failed || status === WorkbenchRunStatus.Failed) {
    return 'destructive';
  }
  if (
    status === WorkbenchTaskStatus.NeedsReview ||
    status === WorkbenchTaskStatus.Paused ||
    status === WorkbenchRunStatus.NeedsReview ||
    status === WorkbenchRunStatus.Paused
  ) {
    return 'outline';
  }
  return 'secondary';
};

export const formatTimestamp = (value: number | null): string =>
  value ? new Date(value).toLocaleString() : '-';

export const formatJson = (value: unknown): string =>
  value === null || value === undefined ? '-' : JSON.stringify(value, null, 2);

export const getRunAttempt = (runs: WorkbenchRun[], runId: string): number | null =>
  runs.find(run => run.id === runId)?.attempt ?? null;

export const getProjectedRun = (detail: WorkbenchTaskDetail | null): WorkbenchRun | null =>
  detail?.runs.find(run => run.id === detail.task.activeRunId) ?? detail?.runs[0] ?? null;

export const filterTaskDetailByRun = (
  detail: WorkbenchTaskDetail,
  runId: string,
): WorkbenchTaskDetail => {
  if (runId === WorkbenchTaskRunFilter.All) return detail;
  return {
    ...detail,
    runs: detail.runs.filter(run => run.id === runId),
    events: detail.events.filter(event => event.runId === runId),
    artifacts: detail.artifacts.filter(artifact => artifact.runId === runId),
    approvals: detail.approvals.filter(approval => approval.runId === runId),
  };
};
