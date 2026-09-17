export function settlePiWorkbenchCompletion(
  active: { isRunning: boolean; completionPending?: Promise<void>; workbenchRunId?: string | null },
  verification: Promise<unknown> | undefined,
  isCurrent: () => boolean,
  complete: () => void,
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
    .then(() => {
      if (!isCurrent() || active.workbenchRunId !== runId) return;
      active.isRunning = false;
      complete();
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
