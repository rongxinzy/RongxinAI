import type { CoworkMessage, CoworkSessionStatus, CoworkStore } from './coworkStore';
import type { CoworkPersistedArtifact } from '../shared/cowork/artifacts';
import { CoworkSessionStatus as SessionStatus } from '../shared/cowork/constants';
import type { CoworkArtifactIndex } from './coworkArtifactIndex';

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

export function readCoworkSessionArtifacts(
  index: Pick<CoworkArtifactIndex, 'listSession' | 'refreshSession'>,
  sessionId: string,
  status: CoworkSessionStatus,
  options: CoworkSessionReadOptions,
): CoworkPersistedArtifact[] {
  // Runtime metadata reads must not rebuild or materialize the artifact index.
  if (options.includeArtifacts === false) return [];
  try {
    return status === SessionStatus.Running
      ? index.listSession(sessionId)
      : index.refreshSession(sessionId);
  } catch (error) {
    console.error(`[CoworkStore] Failed to index artifacts for session ${sessionId}:`, error);
    return [];
  }
}
