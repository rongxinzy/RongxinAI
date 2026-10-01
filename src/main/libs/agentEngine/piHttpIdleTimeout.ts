import { Agent, setGlobalDispatcher } from 'undici';

/**
 * HTTP idle ceiling for the embedded Pi runtime, aligned with the 600s
 * local-provider stream-stall window (STREAM_STALL_TIMEOUT_LOCAL_MS in
 * piStreamStallRecovery.ts). llama.cpp/Ollama emit nothing during prompt
 * evaluation, so undici's 300s default bodyTimeout and the Pi SDK's 300s
 * default request timeout would both cut healthy long turns early.
 */
export const PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS = 600_000;

/** Structural subset of the Pi SDK SettingsManager used here. */
export interface PiHttpIdleTimeoutSettingsManager {
  setHttpIdleTimeoutMs?(timeoutMs: number): void;
}

let globalDispatcherInstalled = false;

/**
 * Raise the two embedded-path HTTP idle ceilings to
 * PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS: the per-request timeout the Pi SDK
 * derives from its settings manager, and the process-wide undici dispatcher
 * floor that would otherwise undercut it at 300s. The dispatcher is installed
 * once; the settings manager is configured per session.
 *
 * Returns true when this call installed the global dispatcher.
 */
export function applyPiEmbeddedHttpIdleTimeout(
  settingsManager: PiHttpIdleTimeoutSettingsManager | null,
): boolean {
  settingsManager?.setHttpIdleTimeoutMs?.(PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS);
  if (globalDispatcherInstalled) return false;
  globalDispatcherInstalled = true;
  setGlobalDispatcher(
    new Agent({
      bodyTimeout: PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS,
      headersTimeout: PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS,
    }),
  );
  console.log(
    `[PiRuntime] raised the embedded HTTP idle timeout to ${PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS / 1000}s for slow local providers`,
  );
  return true;
}
