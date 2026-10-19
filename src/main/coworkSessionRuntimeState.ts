import { CoworkSessionMode, type CoworkSessionStatus } from '../shared/cowork/constants';
import type { CoworkSession, CoworkSessionSummary, CoworkStore } from './coworkStore';

const CoworkRuntimeSessionStatus = {
  Idle: 'idle',
  Running: 'running',
} as const;

type RuntimeTrackedSession = CoworkSession | CoworkSessionSummary;

/**
 * A persisted running status is only a snapshot. Work sessions must still be
 * present in the in-process runtime before the renderer treats them as live.
 *
 * Policy (work package C): the in-process runtime is the authority for "is
 * this session running". Read paths DERIVE the status from it (via this
 * function) without writing corrections back — the row is a projection.
 * Durable corrections happen only at: startup bulk reset (crash leftovers),
 * app quit (stopAll writes idle), and workspace relocation (targeted demote
 * below, because the store's SQL guard reads the raw column).
 */
export const reconcileWorkSessionRuntimeState = <T extends RuntimeTrackedSession>(
  session: T,
  isRuntimeRunning: boolean,
): T => {
  if (
    session.mode !== CoworkSessionMode.Work ||
    session.status !== CoworkRuntimeSessionStatus.Running ||
    isRuntimeRunning
  ) {
    return session;
  }

  return {
    ...session,
    status: CoworkRuntimeSessionStatus.Idle,
  };
};

/**
 * Demote persisted 'running' rows the runtime does not actually run, writing
 * the correction back. Targeted (relocation and similar store-guarded
 * operations); ordinary reads derive instead of healing.
 */
export function demoteStaleRunningSessions(
  store: Pick<CoworkStore, 'updateSession'>,
  isSessionRunning: (sessionId: string) => boolean,
  sessions: readonly RuntimeTrackedSession[],
): void {
  for (const session of sessions) {
    const reconciled = reconcileWorkSessionRuntimeState(session, isSessionRunning(session.id));
    if (reconciled.status !== session.status) {
      store.updateSession(session.id, { status: reconciled.status });
    }
  }
}

/**
 * Imported / historical sessions can never be live: clamp the renderer's
 * status so a save can never resurrect a 'running' row.
 */
export function coerceImportedSessionStatus(status: unknown): CoworkSessionStatus {
  return status === 'completed' || status === 'error' ? status : 'idle';
}
