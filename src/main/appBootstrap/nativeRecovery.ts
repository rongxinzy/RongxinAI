import { getPiRuntimeAdapter } from './sessionServices';
import { getScheduledTaskService, startAutomations } from './automationRuntime';
import { inferenceRuntime } from './inferenceRuntimeState';

let resourcesReady = false;
let recovering: Promise<void> | null = null;
let requested = false;

async function drainRecoveryRequests(): Promise<void> {
  try {
    while (requested) {
      requested = false;
      try {
        if (inferenceRuntime.magpieManager?.status().state === 'running')
          await getPiRuntimeAdapter().recoverSessions();
        await startAutomations();
        if (inferenceRuntime.magpieManager?.status().state === 'running')
          await getScheduledTaskService().retryParked();
      } catch (error) {
        // A newly received notification is an explicit retry request. Otherwise
        // surface the failure and allow a later notification to start a new flight.
        if (!requested) throw error;
      }
    }
  } finally {
    // Release in this same continuation as the final requested check. An outer
    // Promise.finally would leave a microtask gap where a new request could be lost.
    recovering = null;
  }
}

/** Gateway notifications can arrive before skills and MCP finish bootstrapping. */
export function recoverNativeRuntimes(): Promise<void> {
  if (!resourcesReady) return Promise.resolve();
  requested = true;
  // Publish the flight before invoking collaborators, including synchronous
  // callbacks which can themselves announce that another recovery is needed.
  recovering ??= Promise.resolve().then(drainRecoveryRequests);
  return recovering;
}

export async function markNativeResourcesReady(): Promise<void> {
  resourcesReady = true;
  await recoverNativeRuntimes();
}
