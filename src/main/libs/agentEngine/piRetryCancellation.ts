interface RetrySession {
  abort(): Promise<void>;
}

const pendingCancellations = new WeakMap<RetrySession, Promise<void>>();

/** Pi installs its retry controller after notifying auto_retry_start listeners. */
export function cancelPiRetry(session: RetrySession): Promise<void> {
  const existing = pendingCancellations.get(session);
  if (existing) return existing;
  const cancellation = Promise.resolve().then(() => session.abort());
  pendingCancellations.set(session, cancellation);
  void cancellation
    .finally(() => {
      if (pendingCancellations.get(session) === cancellation) pendingCancellations.delete(session);
    })
    .catch((): void => {});
  return cancellation;
}

/** A new prompt must not race the previous run's abort/settled callbacks. */
export function waitForPiRetryCancellation(session: RetrySession): Promise<void> | undefined {
  return pendingCancellations.get(session);
}
