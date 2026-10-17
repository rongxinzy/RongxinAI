/**
 * Shared harness for the CoworkStore per-module test suites.
 *
 * Owns the in-memory SQLite schema (minimum schema the store touches) and the
 * direct row-insertion helpers. Split from src/main/coworkStore.test.ts
 * (issue #1069); the suites under src/main/coworkStore/ drive the public
 * CoworkStore facade through the same schema.
 */
import BetterSqlite3 from 'better-sqlite3';

import { CoworkSessionSource } from '../../shared/cowork/constants';
import { initializeCoworkArtifactIndexSchema } from '../coworkArtifactIndex';
import { CoworkStore } from '../coworkStore';

export interface CoworkStoreTestHarness {
  db: BetterSqlite3.Database;
  store: CoworkStore;
}

/** Initialise a fresh in-memory database with the minimum schema. */
export function createCoworkStoreHarness(): CoworkStoreTestHarness {
  const db = new BetterSqlite3(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      title_user_renamed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle',
      mode TEXT NOT NULL DEFAULT 'work',
      pinned INTEGER NOT NULL DEFAULT 0,
      pin_order INTEGER,
      cwd TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      model_override TEXT NOT NULL DEFAULT '',
      execution_mode TEXT NOT NULL DEFAULT 'local',
      active_skill_ids TEXT,
      workspace_id TEXT,
      agent_id TEXT NOT NULL DEFAULT 'main',
      source TEXT NOT NULL DEFAULT '${CoworkSessionSource.Manual}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_folders (
      workspace_id TEXT NOT NULL,
      path TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, path)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      sequence INTEGER,
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_session_experts (
      session_id TEXT NOT NULL,
      expert_id TEXT NOT NULL,
      package_id TEXT NOT NULL,
      expert_name TEXT NOT NULL,
      source TEXT NOT NULL,
      prompt_snapshot TEXT NOT NULL,
      skill_ids TEXT NOT NULL DEFAULT '[]',
      capability_policy TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, expert_id),
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  initializeCoworkArtifactIndexSchema(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      identity TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      working_directory TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      skill_ids TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      pin_order INTEGER,
      is_default INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'custom',
      preset_id TEXT NOT NULL DEFAULT '',
      triage_override TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // CoworkStore only needs (db)
  return { db, store: new CoworkStore(db) };
}

/** Insert a session row directly. */
export function insertSessionRow(db: BetterSqlite3.Database, id: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO cowork_sessions (id, title, status, mode, pinned, pin_order, cwd, system_prompt, execution_mode, active_skill_ids, workspace_id, agent_id, created_at, updated_at)
     VALUES (?, 'test', 'idle', 'work', 0, NULL, '/tmp', '', 'local', '[]', NULL, 'main', ?, ?)`,
  ).run(id, now, now);
}

/** Insert a message row directly, bypassing CoworkStore.addMessage. */
export function insertMessageRow(
  db: BetterSqlite3.Database,
  id: string,
  sessionId: string,
  type: string,
  content: string,
  metadata: string | null,
  sequence: number,
  createdAt = Date.now(),
): void {
  db.prepare(
    `INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sessionId, type, content, metadata, createdAt, sequence);
}
