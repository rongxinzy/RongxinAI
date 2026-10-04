import { t } from '../i18n';
import {
  isWorkbenchDeliverable,
  WorkbenchArtifactVerificationStatus,
  WorkbenchVerificationCheckStatus,
  WorkbenchVerificationCheckName,
  WorkbenchVerificationOutcome,
  type WorkbenchArtifact,
  type WorkbenchVerificationResult,
} from '../../shared/workbenchTask';

export { isWorkbenchDeliverable } from '../../shared/workbenchTask';

export function applyWorkbenchDeliveryGate(
  result: WorkbenchVerificationResult,
  artifacts: WorkbenchArtifact[],
): WorkbenchVerificationResult {
  if (result.outcome === WorkbenchVerificationOutcome.Failed) return result;
  const deliverables = artifacts.filter(isWorkbenchDeliverable);
  const failed = deliverables.some(
    artifact => artifact.verificationStatus === WorkbenchArtifactVerificationStatus.Failed,
  );
  if (failed) {
    return {
      ...result,
      outcome: WorkbenchVerificationOutcome.Failed,
      checks: [
        ...result.checks,
        {
          name: WorkbenchVerificationCheckName.DeliveryReady,
          status: WorkbenchVerificationCheckStatus.Failed,
          detail: t('workbenchDeliveryHashFailed'),
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
