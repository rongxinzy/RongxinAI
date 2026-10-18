import type { CoworkMessage, CoworkStore } from './coworkStore';
import type { CoworkPersistedArtifact } from '../shared/cowork/artifacts';
import { ArtifactLedger } from './artifactLedger/artifactLedger';

export interface CoworkSessionReadOptions {
  includeArtifacts?: boolean;
}

export function readCoworkSessionMessages(
  store: Pick<CoworkStore, 'countSessionMessages' | 'getPagedSessionMessages'>,
  sessionId: string,
  messageLimit: number | null,
  readAll: () => CoworkMessage[],
): { totalMessages: number; messageOffset: number; messages: CoworkMessage[] } {
  const totalMessages = store.countSessionMessages(sessionId);
  const limit = messageLimit === null ? totalMessages : Math.max(0, messageLimit);
  const messageOffset = Math.max(0, totalMessages - limit);
  const messages =
    limit === 0
      ? []
      : messageOffset > 0
        ? store.getPagedSessionMessages(sessionId, limit, messageOffset)
        : readAll();
  return { totalMessages, messageOffset, messages };
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
