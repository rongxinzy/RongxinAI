import type Database from 'better-sqlite3';

export function initializeCompanionSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companion_chat_turns (
      submission_id INTEGER PRIMARY KEY,
      pet_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      state TEXT NOT NULL,
      input TEXT NOT NULL,
      attachments TEXT,
      text TEXT NOT NULL DEFAULT '',
      UNIQUE (pet_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS companion_chat_turns_history
      ON companion_chat_turns(pet_id, submission_id);
    CREATE INDEX IF NOT EXISTS companion_chat_turns_state
      ON companion_chat_turns(pet_id, state);

    CREATE TABLE IF NOT EXISTS companion_task_admissions (
      pet_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      session_id TEXT NOT NULL, task_id TEXT NOT NULL, run_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY (pet_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS companion_task_admissions_recent
      ON companion_task_admissions(pet_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS companion_task_admissions_session
      ON companion_task_admissions(session_id);

    CREATE TABLE IF NOT EXISTS companion_attachments (
      id TEXT PRIMARY KEY, pet_id TEXT NOT NULL, path TEXT NOT NULL,
      name TEXT NOT NULL, bytes INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS companion_attachments_expiry
      ON companion_attachments(expires_at);
  `);
}
