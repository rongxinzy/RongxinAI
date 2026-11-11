import {
  WorkbenchVerificationOutcome,
  type WorkbenchVerificationResult,
} from '../../../shared/workbenchTask';

export function settlePiWorkbenchCompletion(
  active: { isRunning: boolean; completionPending?: Promise<void>; workbenchRunId?: string | null },
  verification: Promise<WorkbenchVerificationResult | undefined> | undefined,
  isCurrent: () => boolean,
  complete: (verification?: WorkbenchVerificationResult) => void,
  failed: (error: unknown) => void,
): Promise<void> {
  const runId = active.workbenchRunId;
  if (!verification) {
    if (isCurrent()) {
      active.isRunning = false;
      complete();
    }
    return Promise.resolve();
  }
  active.isRunning = true;
  const pending = Promise.resolve(verification)
    .then(result => {
      if (!isCurrent() || active.workbenchRunId !== runId) return;
      if (result?.outcome === WorkbenchVerificationOutcome.Failed) {
        throw new Error(result.summary);
      }
      active.isRunning = false;
      complete(result);
    })
    .catch(error => {
      if (!isCurrent() || active.workbenchRunId !== runId) return;
      active.isRunning = false;
      failed(error);
    })
    .finally(() => {
      if (active.completionPending === pending) active.completionPending = undefined;
    });
  active.completionPending = pending;
  return pending;
}
