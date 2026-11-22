import type Database from 'better-sqlite3';

export function initializeActivitySchema(db: Database.Database): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS zhiyuan_activity_runs (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL,
        started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        session_id TEXT, platform TEXT, conversation_id TEXT, task_name TEXT,
        reply_preview TEXT, error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_zhiyuan_activity_runs_updated
        ON zhiyuan_activity_runs(updated_at DESC);
    `);
}
