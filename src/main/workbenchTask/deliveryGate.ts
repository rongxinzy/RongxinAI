import { CoworkArtifactRole } from '../../shared/cowork/artifacts';
import { t } from '../i18n';
import {
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactKind,
  WorkbenchArtifactVerificationStatus,
  WorkbenchVerificationCheckStatus,
  WorkbenchVerificationCheckName,
  WorkbenchVerificationOutcome,
  type WorkbenchArtifact,
  type WorkbenchVerificationResult,
} from '../../shared/workbenchTask';

export const isWorkbenchDeliverable = (artifact: WorkbenchArtifact): boolean =>
  artifact.kind === WorkbenchArtifactKind.MessageBlock ||
  (artifact.metadata.role !== CoworkArtifactRole.Intermediate &&
    (artifact.metadata.source === WorkbenchArtifactCandidateSource.DomainWorkflow ||
      artifact.metadata.source === WorkbenchArtifactCandidateSource.ProductionInspection ||
      (artifact.metadata.source === WorkbenchArtifactCandidateSource.Declaration &&
        artifact.metadata.role === CoworkArtifactRole.Deliverable)));

export function applyWorkbenchDeliveryGate(
  result: WorkbenchVerificationResult,
  artifacts: WorkbenchArtifact[],
  fileWorkAttempted: boolean,
): WorkbenchVerificationResult {
  if (result.outcome === WorkbenchVerificationOutcome.Failed) return result;
  const deliverables = artifacts.filter(isWorkbenchDeliverable);
  const failed = deliverables.some(
    artifact => artifact.verificationStatus === WorkbenchArtifactVerificationStatus.Failed,
  );
  if (failed || (fileWorkAttempted && deliverables.length === 0)) {
    return {
      ...result,
      outcome: WorkbenchVerificationOutcome.Failed,
      checks: [
        ...result.checks,
        {
          name: WorkbenchVerificationCheckName.DeliveryReady,
          status: WorkbenchVerificationCheckStatus.Failed,
          detail: failed ? t('workbenchDeliveryHashFailed') : t('workbenchDeliveryMissing'),
        },
      ],
      summary: t('workbenchDeliveryNotReady'),
    };
  }
  const pending = deliverables.filter(
    artifact => artifact.verificationStatus === WorkbenchArtifactVerificationStatus.Pending,
  ).length;
  if (pending && result.outcome === WorkbenchVerificationOutcome.Passed) {
    return {
      ...result,
      outcome: WorkbenchVerificationOutcome.AcceptanceRequired,
      checks: [
        {
          name: WorkbenchVerificationCheckName.ArtifactVerification,
          status: WorkbenchVerificationCheckStatus.Skipped,
          detail: t('workbenchDeliverablesRequireAcceptance', { count: String(pending) }),
        },
        ...result.checks,
      ],
      summary: t('workbenchDeliverablesRequireAcceptance', { count: String(pending) }),
    };
  }
  return result;
}
