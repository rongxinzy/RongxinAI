/**
 * SQLite schema for the artifact ledger.
 *
 * The ledger is the single source of truth for artifacts recorded at event
 * time: one row per (scope, file path) with an event-time merge rule. Scopes
 * are Cowork session ids and coding lane ids; there is deliberately no
 * foreign key so coding-lane scopes need no shadow row anywhere.
 */
import type Database from 'better-sqlite3';

export const ARTIFACT_LEDGER_MIGRATION_KEY = 'artifactLedger.legacyCopy.v1.completed';

export function initializeArtifactLedgerSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifact_ledger (
      scope_id TEXT NOT NULL,
      artifact_key TEXT NOT NULL,
      id TEXT NOT NULL,
      message_id TEXT NOT NULL DEFAULT '',
      tool_call_id TEXT,
      run_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      language TEXT,
      file_name TEXT,
      file_path TEXT NOT NULL,
      source TEXT NOT NULL,
      role TEXT NOT NULL,
      declared INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope_id, artifact_key)
    );

    CREATE INDEX IF NOT EXISTS idx_artifact_ledger_scope
      ON artifact_ledger(scope_id, created_at);

    DROP TRIGGER IF EXISTS trg_cowork_artifact_index_message_update;
    DROP TRIGGER IF EXISTS trg_cowork_artifact_index_message_delete;
  `);

  // The cascade trigger needs its target table to exist; SQLite validates the
  // table name at trigger creation time, so create it only once sessions do.
  const sessionsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cowork_sessions'")
    .get();
  if (sessionsTable) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_artifact_ledger_session_delete
      AFTER DELETE ON cowork_sessions
      BEGIN
        DELETE FROM artifact_ledger WHERE scope_id = OLD.id;
      END;
    `);
  }
}

interface LegacyArtifactRow {
  session_id: string;
  artifact_key: string;
  id: string;
  message_id: string;
  type: string;
  title: string;
  content: string;
  language: string | null;
  file_name: string | null;
  file_path: string | null;
  source: string;
  role: string;
  declared: number;
  created_at: number;
}

/**
 * One-time copy of file-backed rows from the legacy message-reparse index
 * (`cowork_session_artifacts`) into the ledger. The legacy table itself stays
 * in place (frozen); only its rows are adopted so history keeps its artifacts.
 * Runs at most once, guarded by a kv marker.
 */
export function migrateLegacyArtifactsToLedger(
  db: Database.Database,
  normalizeKeyPath: (filePath: string) => string,
): void {
  const guard = db
    .prepare('SELECT value FROM kv WHERE key = ?')
    .get(ARTIFACT_LEDGER_MIGRATION_KEY) as { value: string } | undefined;
  if (guard?.value) return;

  let copied = 0;
  try {
    const legacyTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cowork_session_artifacts'",
      )
      .get();
    if (legacyTable) {
      const rows = db
        .prepare(
          `SELECT session_id, artifact_key, id, message_id, type, title, content, language,
                  file_name, file_path, source, role, declared, created_at
           FROM cowork_session_artifacts
           WHERE file_path IS NOT NULL AND file_path <> ''`,
        )
        .all() as LegacyArtifactRow[];
      const insert = db.prepare(
        `INSERT OR IGNORE INTO artifact_ledger (
           scope_id, artifact_key, id, message_id, tool_call_id, run_id, type, title,
           content, language, file_name, file_path, source, role, declared,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const copy = db.transaction(() => {
        for (const row of rows) {
          insert.run(
            row.session_id,
            `path:${normalizeKeyPath(row.file_path as string)}`,
            row.id,
            row.message_id,
            row.type,
            row.title,
            row.content,
            row.language,
            row.file_name,
            row.file_path,
            row.source,
            row.role,
            row.declared,
            row.created_at,
            row.created_at,
          );
          copied += 1;
        }
      });
      copy();
    }
  } catch (error) {
    console.warn('[ArtifactLedger] failed to copy legacy artifacts:', error);
  }

  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(ARTIFACT_LEDGER_MIGRATION_KEY, JSON.stringify(true), Date.now());
  if (copied > 0) {
    console.log(`[ArtifactLedger] adopted ${copied} legacy artifacts into the ledger`);
  }
}
