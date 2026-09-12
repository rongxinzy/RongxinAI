/**
 * Shared teardown for IPC paths that delete cowork sessions in bulk without
 * going through the per-session delete handlers (agent cascade, workspace
 * cascade). Mirrors what cowork:session:delete does per session: purge Pi
 * runtime state (pending queues, workbench tasks, SoL-Pi archives) and drop
 * IM session mappings. Individual failures are contained so one bad session
 * cannot abort the rest of the cascade or skip downstream cleanup.
 */
export interface CoworkSessionTeardownDeps {
  /** Purge runtime state for one session (PiRuntimeAdapter.onSessionDeleted). */
  onSessionDeleted: (sessionId: string) => void;
  /** Drop the IM session mapping for one session; absence is not an error. */
  deleteImMapping: (sessionId: string) => void;
}

export function teardownCascadeDeletedSessions(
  sessionIds: readonly string[],
  deps: CoworkSessionTeardownDeps,
): void {
  for (const sessionId of sessionIds) {
    try {
      deps.onSessionDeleted(sessionId);
    } catch (error) {
      console.error(
        `[Cowork] Failed to purge runtime state for cascade-deleted session ${sessionId}:`,
        error,
      );
    }
  }
  for (const sessionId of sessionIds) {
    try {
      deps.deleteImMapping(sessionId);
    } catch {
      // IM store may not be initialised yet; safe to ignore.
    }
  }
}
