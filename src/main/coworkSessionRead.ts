import type { CoworkPersistedArtifact } from '../shared/cowork/artifacts';
import { ArtifactLedger } from './artifactLedger/artifactLedger';

export interface CoworkSessionReadOptions {
  includeArtifacts?: boolean;
}

/**
 * Session artifacts come from the event-time ledger (single source of truth);
 * running and settled sessions read the same rows. Kept as a choke point so
 * metadata reads can skip artifact loading without callers caring.
 */
export function readCoworkSessionArtifacts(
  ledger: Pick<ArtifactLedger, 'list'>,
  sessionId: string,
  options: CoworkSessionReadOptions,
): CoworkPersistedArtifact[] {
  if (options.includeArtifacts === false) return [];
  try {
    return ledger.list(sessionId);
  } catch (error) {
    console.error(`[CoworkStore] Failed to read artifacts for session ${sessionId}:`, error);
    return [];
  }
}
