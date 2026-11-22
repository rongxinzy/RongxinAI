import type Database from 'better-sqlite3';

export function initializeIMSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS im_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_session_mappings (
      im_conversation_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      cowork_session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      PRIMARY KEY (im_conversation_id, platform)
    );
    CREATE INDEX IF NOT EXISTS idx_channel_session_mappings_cowork
      ON channel_session_mappings(cowork_session_id);

    CREATE TABLE IF NOT EXISTS channel_inbox (
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (platform, account_id, message_id)
    );
  `);
}
