import { Agent, setGlobalDispatcher } from 'undici';

/** Slow local providers may evaluate a prompt without streaming any response bytes. */
export const PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS = 600_000;
let globalDispatcherInstalled = false;

/** Match the native Harness stream timeout at the process HTTP transport boundary. */
export function applyPiEmbeddedHttpIdleTimeout(): boolean {
  if (globalDispatcherInstalled) return false;
  globalDispatcherInstalled = true;
  setGlobalDispatcher(
    new Agent({
      bodyTimeout: PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS,
      headersTimeout: PI_EMBEDDED_HTTP_IDLE_TIMEOUT_MS,
    }),
  );
  return true;
}
