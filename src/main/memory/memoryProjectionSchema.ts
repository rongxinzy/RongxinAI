/** SQLite governance projections; canonical long-term facts belong to the Markdown plugin. */
import type Database from 'better-sqlite3';
import { migrateLegacyMemoryTimestamps } from './memoryTimestampMigration';
import { addColumnIfMissing, runMigrations } from '../sqliteMigrations';
const MEMORY_SCHEMA_SCOPE = 'memory';
export function ensureMemoryProjectionSchema(db: Database.Database): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS memory_links (
        id TEXT PRIMARY KEY,
        memory_id INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        session_id TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        task_id TEXT,
        run_id TEXT,
        artifact_id TEXT,
        approval_id TEXT,
        status TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'decision',
        topic_key TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
        sensitivity TEXT NOT NULL DEFAULT 'normal',
        expires_at TEXT,
        superseded_by TEXT,
        promoted_from_link_id TEXT,
        promotion_source_project_id TEXT,
        promotion_source_session_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memory_links_project
        ON memory_links(project_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_links_session
        ON memory_links(session_id, status);

      CREATE TABLE IF NOT EXISTS memory_candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'personal://zhiyuan-agent/user',
        project_root TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'personal',
        session_id TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        task_id TEXT,
        run_id TEXT,
        artifact_id TEXT,
        approval_id TEXT,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        kind TEXT NOT NULL,
        topic_key TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
        sensitivity TEXT NOT NULL DEFAULT 'normal',
        expires_at TEXT,
        supersedes_link_id TEXT,
        promoted_from_link_id TEXT,
        promotion_source_project_id TEXT,
        promotion_source_session_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS memory_outbox (
        id TEXT PRIMARY KEY,
        link_id TEXT,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memory_outbox_pending
        ON memory_outbox(status, available_at, created_at);

      CREATE TABLE IF NOT EXISTS memory_import_rejections (
        id TEXT PRIMARY KEY,
        rejected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
  ensureAddedColumns(db);
}

function ensureAddedColumns(db: Database.Database): void {
  if (typeof db.prepare !== 'function') return;
  runMigrations(db, MEMORY_SCHEMA_SCOPE, [
    { version: 1, name: 'legacy-reconcile', up: d => reconcileLegacyMemorySchema(d) },
  ]);
}

/**
 * Legacy reconcile: the column adds and timestamp rewrite that used to be
 * re-probed on every repository construction. Idempotent by construction,
 * so a fresh database runs through it as a no-op and records the version.
 */
function reconcileLegacyMemorySchema(db: Database.Database): void {
  const additions: Record<string, string> = {
    title: "TEXT NOT NULL DEFAULT ''",
    content: "TEXT NOT NULL DEFAULT ''",
    kind: "TEXT NOT NULL DEFAULT 'decision'",
    topic_key: 'TEXT',
    importance: 'REAL NOT NULL DEFAULT 0.5',
    confidence: 'REAL NOT NULL DEFAULT 0.5',
    sensitivity: "TEXT NOT NULL DEFAULT 'normal'",
    expires_at: 'TEXT',
    superseded_by: 'TEXT',
    promoted_from_link_id: 'TEXT',
    promotion_source_project_id: 'TEXT',
    promotion_source_session_id: 'TEXT',
  };
  for (const [name, definition] of Object.entries(additions)) {
    addColumnIfMissing(db, 'memory_links', name, definition);
  }
  addColumnIfMissing(db, 'memory_outbox', 'link_id', 'TEXT');
  const candidateAdditions: Record<string, string> = {
    project_id: "TEXT NOT NULL DEFAULT 'personal://zhiyuan-agent/user'",
    project_root: "TEXT NOT NULL DEFAULT ''",
    scope: "TEXT NOT NULL DEFAULT 'personal'",
    promoted_from_link_id: 'TEXT',
    promotion_source_project_id: 'TEXT',
    promotion_source_session_id: 'TEXT',
  };
  for (const [name, definition] of Object.entries(candidateAdditions)) {
    addColumnIfMissing(db, 'memory_candidates', name, definition);
  }
  migrateLegacyMemoryTimestamps(db);
}
