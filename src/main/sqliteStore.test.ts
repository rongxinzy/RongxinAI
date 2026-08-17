import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import {
  AgentAvatarSvg,
  DefaultAgentAvatarIcon,
  DefaultAgentProfile,
  encodeAgentAvatarIcon,
} from '../shared/agent';
import { CoworkSessionSource } from '../shared/cowork/constants';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => '/tmp',
  },
}));

import { DB_FILENAME } from './appConstants';
import { SqliteStore } from './sqliteStore';

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

const createTempUserDataPath = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-sqlite-store-'));
  tempDirs.push(dir);
  return dir;
};

const createLegacyDatabase = (userDataPath: string): void => {
  const db = new Database(path.join(userDataPath, DB_FILENAME));
  const now = Date.now();

  db.exec(`
    CREATE TABLE kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE cowork_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      identity TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      skill_ids TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'custom',
      preset_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.prepare('INSERT INTO cowork_config (key, value, updated_at) VALUES (?, ?, ?)').run(
    'workingDirectory',
    '/repo/legacy',
    now,
  );
  db.prepare(
    `INSERT INTO agents (
      id, name, description, system_prompt, identity, model, icon, skill_ids,
      enabled, is_default, source, preset_id, created_at, updated_at
    ) VALUES (?, ?, '', '', '', '', '', '[]', 1, ?, 'custom', '', ?, ?)`,
  ).run('main', 'main', 1, now, now);
  db.prepare(
    `INSERT INTO agents (
      id, name, description, system_prompt, identity, model, icon, skill_ids,
      enabled, is_default, source, preset_id, created_at, updated_at
    ) VALUES (?, ?, '', '', '', '', '', '[]', 1, ?, 'custom', '', ?, ?)`,
  ).run('docs', 'Docs', 0, now, now);

  db.close();
};

test('backfills agent working directories from legacy cowork config only once', async () => {
  const userDataPath = createTempUserDataPath();
  createLegacyDatabase(userDataPath);

  const store = await SqliteStore.create(userDataPath);
  const db = store.getDatabase();
  const rows = db.prepare('SELECT id, working_directory FROM agents ORDER BY id').all() as Array<{
    id: string;
    working_directory: string;
  }>;

  expect(rows).toEqual([
    { id: 'docs', working_directory: '/repo/legacy' },
    { id: 'main', working_directory: '/repo/legacy' },
  ]);

  db.prepare("UPDATE agents SET working_directory = '' WHERE id = 'docs'").run();
  store.close();

  const reopenedStore = await SqliteStore.create(userDataPath);
  const reopenedRows = reopenedStore
    .getDatabase()
    .prepare('SELECT id, working_directory FROM agents ORDER BY id')
    .all() as Array<{ id: string; working_directory: string }>;

  expect(reopenedRows).toEqual([
    { id: 'docs', working_directory: '' },
    { id: 'main', working_directory: '/repo/legacy' },
  ]);

  reopenedStore.close();
});

test('upgrades legacy default agent name during migration', async () => {
  const userDataPath = createTempUserDataPath();
  createLegacyDatabase(userDataPath);

  const store = await SqliteStore.create(userDataPath);
  const row = store.getDatabase().prepare("SELECT name FROM agents WHERE id = 'main'").get() as {
    name: string;
  };

  expect(row.name).toBe(DefaultAgentProfile.Name);

  store.close();
});

test('migrates legacy agent icons to the default svg avatar', async () => {
  const userDataPath = createTempUserDataPath();
  createLegacyDatabase(userDataPath);

  const designedIcon = encodeAgentAvatarIcon({
    svg: AgentAvatarSvg.Code,
  });
  const db = new Database(path.join(userDataPath, DB_FILENAME));
  const now = Date.now();
  db.prepare("UPDATE agents SET icon = ? WHERE id = 'main'").run('legacy-icon');
  db.prepare(
    `INSERT INTO agents (
      id, name, description, system_prompt, identity, model, icon, skill_ids,
      enabled, is_default, source, preset_id, created_at, updated_at
    ) VALUES (?, ?, '', '', '', '', ?, '[]', 1, 0, 'custom', '', ?, ?)`,
  ).run('code', 'Code', designedIcon, now, now);
  db.prepare(
    `INSERT INTO agents (
      id, name, description, system_prompt, identity, model, icon, skill_ids,
      enabled, is_default, source, preset_id, created_at, updated_at
    ) VALUES (?, ?, '', '', '', '', ?, '[]', 1, 0, 'custom', '', ?, ?)`,
  ).run('legacy-designed', 'Legacy Designed', 'agent-avatar:blue:code', now, now);
  db.close();

  const store = await SqliteStore.create(userDataPath);
  const rows = store
    .getDatabase()
    .prepare('SELECT id, icon FROM agents ORDER BY id')
    .all() as Array<{ id: string; icon: string }>;

  expect(rows).toEqual([
    { id: 'code', icon: designedIcon },
    { id: 'docs', icon: DefaultAgentAvatarIcon },
    { id: 'legacy-designed', icon: DefaultAgentAvatarIcon },
    { id: 'main', icon: DefaultAgentAvatarIcon },
  ]);

  store.close();
});

test('adds agent pin columns during migration', async () => {
  const userDataPath = createTempUserDataPath();
  createLegacyDatabase(userDataPath);

  const store = await SqliteStore.create(userDataPath);
  const columns = store.getDatabase().pragma('table_info(agents)') as Array<{ name: string }>;
  const columnNames = columns.map(column => column.name);
  const rows = store
    .getDatabase()
    .prepare('SELECT id, pinned, pin_order FROM agents ORDER BY id')
    .all() as Array<{ id: string; pinned: number; pin_order: number | null }>;

  expect(columnNames).toContain('pinned');
  expect(columnNames).toContain('pin_order');
  expect(rows).toEqual([
    { id: 'docs', pinned: 0, pin_order: null },
    { id: 'main', pinned: 0, pin_order: null },
  ]);

  store.close();
});

test('backfills legacy scheduled sessions only when adding the source column', async () => {
  const userDataPath = createTempUserDataPath();
  createLegacyDatabase(userDataPath);
  const legacyDb = new Database(path.join(userDataPath, DB_FILENAME));
  const now = Date.now();
  legacyDb.exec(`
    CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      claude_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      mode TEXT NOT NULL DEFAULT 'work',
      cwd TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const insertLegacySession = legacyDb.prepare(`
    INSERT INTO cowork_sessions
      (id, title, status, mode, cwd, system_prompt, created_at, updated_at)
    VALUES (?, ?, 'idle', 'work', '/repo', '', ?, ?)
  `);
  insertLegacySession.run('scheduled-cn', ' [定时]日报', now, now);
  insertLegacySession.run('scheduled-en', '[Cron] report', now, now);
  insertLegacySession.run('scheduled-executor', 'Scheduled: report', now, now);
  insertLegacySession.run('manual', 'ordinary conversation', now, now);
  legacyDb.close();

  const store = await SqliteStore.create(userDataPath);
  const migratedRows = store
    .getDatabase()
    .prepare('SELECT id, source FROM cowork_sessions ORDER BY id')
    .all() as Array<{ id: string; source: string }>;

  expect(migratedRows).toEqual([
    { id: 'manual', source: CoworkSessionSource.Manual },
    { id: 'scheduled-cn', source: CoworkSessionSource.Scheduled },
    { id: 'scheduled-en', source: CoworkSessionSource.Scheduled },
    { id: 'scheduled-executor', source: CoworkSessionSource.Scheduled },
  ]);

  store
    .getDatabase()
    .prepare(
      `INSERT INTO cowork_sessions
        (id, title, status, mode, pinned, cwd, system_prompt, source, created_at, updated_at)
       VALUES (?, ?, 'idle', 'work', 0, '/repo', '', ?, ?, ?)`,
    )
    .run('manual-prefixed', '[Cron] user-authored title', CoworkSessionSource.Manual, now, now);
  store.close();

  const reopenedStore = await SqliteStore.create(userDataPath);
  const reopenedRow = reopenedStore
    .getDatabase()
    .prepare('SELECT source FROM cowork_sessions WHERE id = ?')
    .get('manual-prefixed') as { source: string };
  expect(reopenedRow.source).toBe(CoworkSessionSource.Manual);
  reopenedStore.close();
});

test('creates the artifact index after adding sequence to legacy messages', async () => {
  const userDataPath = createTempUserDataPath();
  createLegacyDatabase(userDataPath);
  const db = new Database(path.join(userDataPath, DB_FILENAME));
  const now = Date.now();
  db.exec(`
    CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      claude_session_id TEXT,
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
  db.prepare(
    `INSERT INTO cowork_sessions
       (id, title, status, mode, cwd, system_prompt, created_at, updated_at)
     VALUES ('session-1', 'legacy', 'idle', 'work', '/repo', '', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO cowork_messages
       (id, session_id, type, content, metadata, created_at)
     VALUES ('message-1', 'session-1', 'assistant', 'hello', NULL, ?)`,
  ).run(now);
  db.close();

  const store = await SqliteStore.create(userDataPath);
  const migratedDb = store.getDatabase();
  const messageColumns = migratedDb.pragma('table_info(cowork_messages)') as Array<{
    name: string;
  }>;
  const artifactTables = migratedDb
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN (
         'cowork_session_artifacts', 'cowork_artifact_index_state'
       )
       ORDER BY name`,
    )
    .all() as Array<{ name: string }>;

  expect(messageColumns.map(column => column.name)).toContain('sequence');
  expect(artifactTables.map(table => table.name)).toEqual([
    'cowork_artifact_index_state',
    'cowork_session_artifacts',
  ]);

  store.close();
});
