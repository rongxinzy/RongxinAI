import { CoworkSessionMode } from '../shared/cowork/constants';
import type { CoworkSession, CoworkSessionSummary } from './coworkStore';

const CoworkRuntimeSessionStatus = {
  Idle: 'idle',
  Running: 'running',
} as const;

type RuntimeTrackedSession = CoworkSession | CoworkSessionSummary;

/**
 * A persisted running status is only a snapshot. Work sessions must still be
 * present in the in-process runtime before the renderer treats them as live.
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
