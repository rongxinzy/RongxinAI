import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import { DB_FILENAME } from './appConstants';
import { applyCoreSchema } from './coreSchema';
import { SqliteStore } from './sqliteStore';
import { SCHEMA_MIGRATIONS_TABLE } from './sqliteMigrations';
import { initializeCodingAgentSchema } from './codingAgent/schema';
import { initializeWorkbenchTaskSchema } from './workbenchTask/schema';
import { initializeTodoSchema } from './todo/schema';
import { MemoryRepository } from './memory/repository';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => '/tmp',
  },
}));

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
  vi.restoreAllMocks();
});

const createTempUserDataPath = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-schema-migrations-'));
  tempDirs.push(dir);
  return dir;
};

const scopeRow = (
  db: Database.Database,
  scope: string,
): { version: number; updated_at: number } | undefined => {
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(SCHEMA_MIGRATIONS_TABLE);
  if (!hasTable) return undefined;
  return db
    .prepare(`SELECT version, updated_at FROM ${SCHEMA_MIGRATIONS_TABLE} WHERE scope = ?`)
    .get(scope) as { version: number; updated_at: number } | undefined;
};

const columnNames = (db: Database.Database, table: string): Set<string> =>
  new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      column => column.name,
    ),
  );

test('fresh database: schema initializes, versions recorded, migrations do not re-run', async () => {
  const userDataPath = createTempUserDataPath();

  const store = await SqliteStore.create(userDataPath);
  const db = store.getDatabase();

  // core is at 2 (legacy reconcile + electron-store import); module scopes at 1.
  for (const scope of ['workbench-task', 'coding-agent', 'todo']) {
    expect(scopeRow(db, scope)?.version).toBe(1);
  }
  expect(scopeRow(db, 'core')?.version).toBe(2);
  expect(columnNames(db, 'cowork_messages').has('sequence')).toBe(true);
  expect(columnNames(db, 'agents').has('working_directory')).toBe(true);

  const coreRow = scopeRow(db, 'core');
  const workbenchRow = scopeRow(db, 'workbench-task');
  store.close();

  // Reopen: recorded versions are unchanged (no migration re-ran).
  const reopenedStore = await SqliteStore.create(userDataPath);
  const reopenedDb = reopenedStore.getDatabase();
  expect(scopeRow(reopenedDb, 'core')).toEqual(coreRow);
  expect(scopeRow(reopenedDb, 'workbench-task')).toEqual(workbenchRow);
  reopenedStore.close();
});

test('legacy cowork database: columns added, sequence backfilled, version recorded once', async () => {
  const userDataPath = createTempUserDataPath();
  const dbPath = path.join(userDataPath, DB_FILENAME);
  const now = Date.now();

  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      mode TEXT NOT NULL DEFAULT 'work',
      cwd TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  const insertSession = legacy.prepare(
    `INSERT INTO cowork_sessions (id, title, status, mode, cwd, system_prompt, created_at, updated_at)
     VALUES (?, ?, 'idle', 'work', '/repo', '', ?, ?)`,
  );
  insertSession.run('session-1', 'first session', now, now);
  insertSession.run('session-2', 'second session', now + 100, now + 100);
  const insertMessage = legacy.prepare(
    `INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at)
     VALUES (?, ?, 'assistant', 'hello', NULL, ?)`,
  );
  // Deliberately interleaved insert order with distinct created_at values.
  insertMessage.run('s2-m1', 'session-2', now + 300);
  insertMessage.run('s1-m2', 'session-1', now + 200);
  insertMessage.run('s1-m1', 'session-1', now + 100);
  insertMessage.run('s2-m2', 'session-2', now + 400);
  legacy.close();

  const store = await SqliteStore.create(userDataPath);
  const migrated = store.getDatabase();

  const sessionColumns = columnNames(migrated, 'cowork_sessions');
  for (const column of [
    'title_user_renamed',
    'pinned',
    'pin_order',
    'model_override',
    'execution_mode',
    'workspace_id',
    'source',
    'agent_id',
  ]) {
    expect(sessionColumns.has(column)).toBe(true);
  }
  expect(columnNames(migrated, 'cowork_messages').has('sequence')).toBe(true);
  expect(columnNames(migrated, 'agents').has('working_directory')).toBe(true);
  expect(columnNames(migrated, 'workspaces').has('is_hidden')).toBe(true);

  // sequence backfilled per session in created_at order.
  const sequences = migrated
    .prepare('SELECT id, sequence FROM cowork_messages ORDER BY id')
    .all() as Array<{ id: string; sequence: number }>;
  expect(sequences).toEqual([
    { id: 's1-m1', sequence: 1 },
    { id: 's1-m2', sequence: 2 },
    { id: 's2-m1', sequence: 1 },
    { id: 's2-m2', sequence: 2 },
  ]);

  // workspace_id backfilled for every legacy session.
  const workspaceBackfill = migrated
    .prepare(
      "SELECT COUNT(*) AS count FROM cowork_sessions WHERE workspace_id IS NULL OR workspace_id = ''",
    )
    .get() as { count: number };
  expect(workspaceBackfill.count).toBe(0);

  // The message-order expression index exists and is usable.
  const plan = migrated
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM cowork_messages WHERE session_id = ?
       ORDER BY COALESCE(sequence, created_at) DESC, created_at DESC, ROWID DESC LIMIT 1`,
    )
    .all('session-1') as Array<{ detail: string }>;
  expect(plan.map(row => row.detail).join('\n')).not.toContain('TEMP B-TREE');

  expect(scopeRow(migrated, 'core')?.version).toBe(2);
  const coreRow = scopeRow(migrated, 'core');
  store.close();

  // Reopen: the version row is untouched, so no probe runs again.
  const reopenedStore = await SqliteStore.create(userDataPath);
  expect(scopeRow(reopenedStore.getDatabase(), 'core')).toEqual(coreRow);
  reopenedStore.close();
});

test('legacy coding agent database: columns added, data repaired, version recorded', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE coding_rooms (
        id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL UNIQUE,
        active_mission_id TEXT, active_lane_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE coding_workspace_sources (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, path TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, UNIQUE(room_id, path)
      );
      CREATE TABLE coding_missions (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE coding_agent_profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
        driver_kind TEXT NOT NULL, status TEXT NOT NULL, capabilities_json TEXT NOT NULL,
        command TEXT, args_json TEXT NOT NULL, is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE coding_agent_lanes (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, profile_id TEXT NOT NULL, execution_root TEXT NOT NULL DEFAULT '',
        local_session_id TEXT NOT NULL, remote_session_id TEXT, status TEXT NOT NULL,
        draft TEXT NOT NULL DEFAULT '', scroll_position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE coding_assignments (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, lane_id TEXT NOT NULL,
        title TEXT NOT NULL, instructions TEXT NOT NULL, status TEXT NOT NULL,
        workbench_task_id TEXT, workbench_run_id TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE coding_events (
        id TEXT PRIMARY KEY, lane_id TEXT NOT NULL, sequence INTEGER NOT NULL, kind TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(lane_id, sequence)
      );
      CREATE TABLE coding_elicitations (
        id TEXT PRIMARY KEY, lane_id TEXT NOT NULL, question TEXT NOT NULL, status TEXT NOT NULL,
        created_at INTEGER NOT NULL, answer TEXT, cancel_reason TEXT
      );
      CREATE TABLE coding_workspace_leases (room_id TEXT PRIMARY KEY, lane_id TEXT, acquired_at INTEGER);
      CREATE TABLE coding_source_writer_leases (
        room_id TEXT NOT NULL, source_root TEXT NOT NULL, lane_id TEXT, acquired_at INTEGER,
        PRIMARY KEY(room_id, source_root)
      );
      CREATE TABLE coding_handoffs (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, source_lane_id TEXT NOT NULL,
        target_lane_id TEXT NOT NULL, content_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
    const now = Date.now();
    db.prepare(
      `INSERT INTO coding_rooms (id, workspace_root, active_mission_id, active_lane_id, created_at, updated_at)
       VALUES ('room-1', '/repo/coding', NULL, NULL, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO coding_missions (id, room_id, title, goal, status, created_at, updated_at)
       VALUES ('mission-1', 'room-1', 'Mission', 'Goal', 'active', ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO coding_agent_lanes (id, mission_id, profile_id, execution_root, local_session_id, status, created_at, updated_at)
       VALUES ('lane-1', 'mission-1', 'profile-1', '/repo/coding', 'session-1', 'idle', ?, ?)`,
    ).run(now, now);

    initializeCodingAgentSchema(db);

    const roomColumns = columnNames(db, 'coding_rooms');
    expect(roomColumns.has('name')).toBe(true);
    expect(roomColumns.has('default_profile_id')).toBe(true);
    const laneColumns = columnNames(db, 'coding_agent_lanes');
    for (const column of [
      'model_override',
      'source_root',
      'config_options_json',
      'available_commands_json',
      'pending_recovery_prompt',
      'pending_recovery_context',
    ]) {
      expect(laneColumns.has(column)).toBe(true);
    }
    expect(columnNames(db, 'coding_missions').has('git_baseline')).toBe(true);
    expect(columnNames(db, 'coding_agent_profiles').has('auth_methods_json')).toBe(true);
    expect(columnNames(db, 'coding_agent_profiles').has('environment_json')).toBe(true);
    expect(columnNames(db, 'coding_assignments').has('workflow_stage')).toBe(true);
    expect(columnNames(db, 'coding_assignments').has('previous_assignment_id')).toBe(true);

    // Legacy data repair: names backfilled, primary source inserted, source_root derived.
    const room = db.prepare('SELECT name FROM coding_rooms WHERE id = ?').get('room-1') as {
      name: string;
    };
    expect(room.name).toBe('/repo/coding');
    const primarySource = db
      .prepare(
        'SELECT path, is_primary FROM coding_workspace_sources WHERE room_id = ? AND is_primary = 1',
      )
      .get('room-1') as { path: string; is_primary: number };
    expect(primarySource).toEqual({ path: '/repo/coding', is_primary: 1 });
    const lane = db
      .prepare('SELECT source_root FROM coding_agent_lanes WHERE id = ?')
      .get('lane-1') as { source_root: string };
    expect(lane.source_root).toBe('/repo/coding');

    expect(scopeRow(db, 'coding-agent')?.version).toBe(1);
    const versionRow = scopeRow(db, 'coding-agent');

    // Re-running the initializer does not re-run the reconcile.
    initializeCodingAgentSchema(db);
    expect(scopeRow(db, 'coding-agent')).toEqual(versionRow);
  } finally {
    db.close();
  }
});

test('legacy workbench task database: run columns added and version recorded', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE workbench_tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        contract_json TEXT NOT NULL,
        active_run_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE TABLE workbench_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        trigger TEXT NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        verification_result_json TEXT,
        failure_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES workbench_tasks(id),
        UNIQUE(task_id, attempt)
      );
    `);
    const now = Date.now();
    db.prepare(
      `INSERT INTO workbench_tasks (id, session_id, goal, status, contract_json, created_at, updated_at)
       VALUES ('task-1', 'session-1', 'Goal', 'pending', '{}', ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO workbench_runs (id, task_id, attempt, status, trigger, created_at, updated_at)
       VALUES ('run-1', 'task-1', 1, 'running', 'manual', ?, ?)`,
    ).run(now, now);

    initializeWorkbenchTaskSchema(db);

    const runColumns = columnNames(db, 'workbench_runs');
    expect(runColumns.has('context_json')).toBe(true);
    expect(runColumns.has('final_answer_json')).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS c FROM workbench_runs').get()).toEqual({ c: 1 });

    expect(scopeRow(db, 'workbench-task')?.version).toBe(1);
    const versionRow = scopeRow(db, 'workbench-task');

    initializeWorkbenchTaskSchema(db);
    expect(scopeRow(db, 'workbench-task')).toEqual(versionRow);
  } finally {
    db.close();
  }
});

test('core scope failure rolls back and rethrows, leaving the version un-advanced', async () => {
  const userDataPath = createTempUserDataPath();
  const dbPath = path.join(userDataPath, DB_FILENAME);
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      mode TEXT NOT NULL DEFAULT 'work',
      cwd TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );
    -- Abort the reconcile partway through: the trigger fires when the
    -- working-directory backfill marker is written to kv.
    CREATE TRIGGER reject_core_migration
    BEFORE INSERT ON kv
    WHEN NEW.key = 'agents.workingDirectoryBackfill.v1.completed'
    BEGIN SELECT RAISE(ABORT, 'simulated core migration failure'); END;
  `);
  legacy.close();

  const db = new Database(dbPath);
  expect(() => applyCoreSchema(db, userDataPath)).toThrow('simulated core migration failure');
  // The failed migration's version bump rolled back with its body: the scope
  // has no row at all instead of advancing to the failed version.
  expect(scopeRow(db, 'core')).toBeUndefined();
  // The column adds executed earlier inside the same migration rolled back.
  expect(columnNames(db, 'cowork_sessions').has('pinned')).toBe(false);
  expect(columnNames(db, 'cowork_messages').has('sequence')).toBe(false);
  db.close();
});

test('memory repository records its scope version and does not re-run reconcile', () => {
  const db = new Database(':memory:');
  try {
    new MemoryRepository(db);
    expect(scopeRow(db, 'memory')?.version).toBe(4);
    expect(columnNames(db, 'memory_checkpoints').has('checkpoint_sequence')).toBe(true);
    expect(columnNames(db, 'memory_runtime_sessions').has('runtime_session_id')).toBe(true);
    expect(columnNames(db, 'memory_runtime_sessions').has('is_current')).toBe(true);
    expect(columnNames(db, 'memory_session_finalizations').has('status')).toBe(true);
    const versionRow = scopeRow(db, 'memory');

    new MemoryRepository(db);
    expect(scopeRow(db, 'memory')).toEqual(versionRow);
  } finally {
    db.close();
  }
});

test('todo scope records its version on fresh databases', () => {
  const db = new Database(':memory:');
  try {
    initializeTodoSchema(db);
    expect(scopeRow(db, 'todo')?.version).toBe(1);
    const versionRow = scopeRow(db, 'todo');
    initializeTodoSchema(db);
    expect(scopeRow(db, 'todo')).toEqual(versionRow);
  } finally {
    db.close();
  }
});
