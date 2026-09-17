import { t } from '../i18n';
import {
  isWorkbenchDeliverable,
  matchesOutputRequirement,
  WorkbenchOutputMode,
  WorkbenchArtifactVerificationStatus,
  WorkbenchVerificationCheckStatus,
  WorkbenchVerificationCheckName,
  WorkbenchVerificationOutcome,
  type WorkbenchArtifact,
  type WorkbenchVerificationResult,
  type WorkbenchTaskContract,
} from '../../shared/workbenchTask';

export { isWorkbenchDeliverable } from '../../shared/workbenchTask';

export function applyWorkbenchDeliveryGate(
  result: WorkbenchVerificationResult,
  artifacts: WorkbenchArtifact[],
  contract: WorkbenchTaskContract,
): WorkbenchVerificationResult {
  if (result.outcome === WorkbenchVerificationOutcome.Failed) return result;
  const deliverables = artifacts.filter(artifact => isWorkbenchDeliverable(artifact, contract));
  const requirements = contract.outputRequirements;
  const missing =
    requirements?.length === 0 ||
    requirements?.some(
      requirement =>
        requirement.mode !== WorkbenchOutputMode.Text &&
        !deliverables.some(artifact => matchesOutputRequirement(artifact, requirement)),
    );
  const failed = deliverables.some(
    artifact => artifact.verificationStatus === WorkbenchArtifactVerificationStatus.Failed,
  );
  if (failed || missing) {
    return {
      ...result,
      outcome: WorkbenchVerificationOutcome.Failed,
      checks: [
        ...result.checks,
        {
          name: WorkbenchVerificationCheckName.DeliveryReady,
          status: WorkbenchVerificationCheckStatus.Failed,
          detail: failed
            ? t('workbenchDeliveryHashFailed')
            : requirements?.length === 0
              ? t('workbenchOutputContractMissing')
              : t('workbenchDeliveryMissing'),
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
