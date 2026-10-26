import type Database from 'better-sqlite3';

/** Shared admission schema; ownership survives identity switches and process restarts. */
export function initializeCompanionTaskAdmissions(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS companion_task_admissions (
    pet_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
    session_id TEXT NOT NULL, task_id TEXT NOT NULL, run_id TEXT NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY (pet_id, request_id)
  ); CREATE INDEX IF NOT EXISTS companion_task_admissions_recent
    ON companion_task_admissions(pet_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS companion_task_admissions_session
    ON companion_task_admissions(session_id);`);
}

/** Use the committed admission, never a renderer-supplied pet ID or the current selection. */
export function resolveCompanionTaskOwner(db: Database.Database, sessionId: string): string | null {
  const row = db
    .prepare('SELECT pet_id FROM companion_task_admissions WHERE session_id = ?')
    .get(sessionId) as { pet_id: string } | undefined;
  return row?.pet_id ?? null;
}
