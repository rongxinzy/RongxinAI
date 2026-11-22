import { CoworkSessionStatus } from '../shared/cowork/constants';
import type { CoworkSession, CoworkSessionSummary } from './coworkStore';

type RuntimeTrackedSession = CoworkSession | CoworkSessionSummary;

/** Pi owns liveness, including initialization. SQLite keeps terminal status. */
export const projectCoworkSessionRuntimeState = <T extends RuntimeTrackedSession>(
  session: T,
  isRuntimeRunning: boolean,
): T => {
  return isRuntimeRunning ? { ...session, status: CoworkSessionStatus.Running } : session;
};
