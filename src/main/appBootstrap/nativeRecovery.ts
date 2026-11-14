import { getPiRuntimeAdapter } from './sessionServices';
import { getScheduledTaskService, startAutomations } from './automationRuntime';
import { inferenceRuntime } from './inferenceRuntimeState';

let resourcesReady = false;
let recovering: Promise<void> | null = null;

/** Gateway notifications can arrive before skills and MCP finish bootstrapping. */
export function recoverNativeRuntimes(): Promise<void> {
  if (!resourcesReady) return Promise.resolve();
  if (recovering) return recovering;
  recovering = (async () => {
    if (inferenceRuntime.magpieManager?.status().state === 'running')
      await getPiRuntimeAdapter().recoverSessions();
    await startAutomations();
    if (inferenceRuntime.magpieManager?.status().state === 'running')
      await getScheduledTaskService().retryParked();
  })().finally(() => {
    recovering = null;
  });
  return recovering;
}

export async function markNativeResourcesReady(): Promise<void> {
  resourcesReady = true;
  await recoverNativeRuntimes();
}
