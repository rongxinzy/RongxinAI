/**
 * Cross-view hand-off between the sidebar and the automation view.
 *
 * The sidebar's folder action asks the automation view to open its create
 * dialog for a specific folder. The automation view is mounted lazily, so the
 * request is parked when nothing is listening and delivered straight to the
 * live listener when the view is already on screen.
 */
export interface ScheduledTaskCreateRequest {
  workspaceId?: string;
}

type ScheduledTaskCreateListener = (request: ScheduledTaskCreateRequest) => void;

let pendingRequest: ScheduledTaskCreateRequest | null = null;
const listeners = new Set<ScheduledTaskCreateListener>();

/** Ask the automation view to open its create dialog, optionally for one folder. */
export const requestScheduledTaskCreate = (request: ScheduledTaskCreateRequest = {}): void => {
  if (listeners.size > 0) {
    // The view is mounted: deliver now instead of parking, so a request can
    // never surface later against an unrelated mount.
    pendingRequest = null;
    for (const listener of listeners) listener(request);
    return;
  }
  pendingRequest = request;
};

/** Read and clear the parked create request, if any. */
export const consumeScheduledTaskCreateRequest = (): ScheduledTaskCreateRequest | null => {
  const request = pendingRequest;
  pendingRequest = null;
  return request;
};

/**
 * Subscribe the mounted automation view. A request parked before it mounted is
 * flushed to the new listener immediately, so both paths behave identically.
 */
export const subscribeScheduledTaskCreateRequest = (
  listener: ScheduledTaskCreateListener,
): (() => void) => {
  listeners.add(listener);
  const parked = consumeScheduledTaskCreateRequest();
  if (parked) listener(parked);
  return () => {
    listeners.delete(listener);
  };
};
