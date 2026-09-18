import type Database from 'better-sqlite3';

import type { CoworkError } from '../common/coworkError';
import { CoworkMessageType, CoworkSessionStatus } from '../shared/cowork/constants';
import type { CoworkMessage, CoworkStore } from './coworkStore';

/** Persist initialization failures without loading sessions or scanning artifacts. */
export function persistCoworkTerminalError(
  db: Database.Database,
  store: Pick<CoworkStore, 'addMessage' | 'updateSession'>,
  sessionId: string,
  error: CoworkError,
  emitMessage: (message: CoworkMessage) => void,
): void {
  const message = db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM cowork_sessions WHERE id = ?').get(sessionId)) return null;

    // Only inspect a terminal system message; never materialize tool results or history.
    const latest = db
      .prepare<[string, string, string], { error: unknown; errorKind: unknown }>(`
      SELECT
        CASE WHEN type = ? THEN
          CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.error') END
        END AS error,
        CASE WHEN type = ? THEN
          CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.errorKind') END
        END AS errorKind
      FROM (
        SELECT type, metadata FROM cowork_messages
        WHERE session_id = ?
        ORDER BY COALESCE(sequence, created_at) DESC, created_at DESC, ROWID DESC
        LIMIT 1
      )
    `)
      .get(CoworkMessageType.System, CoworkMessageType.System, sessionId);

    store.updateSession(sessionId, { status: CoworkSessionStatus.Error });
    if (!error.message || (latest?.error === error.message && latest.errorKind === error.kind)) {
      return null;
    }
    return store.addMessage(sessionId, {
      type: CoworkMessageType.System,
      content: '',
      metadata: { error: error.message, errorKind: error.kind },
    });
  })();

  // Commit before IPC so switching sessions immediately sees the canonical message.
  if (message) emitMessage(message);
}
