/**
 * Cowork-core schema: current-shape DDL plus the versioned migration list.
 *
 * `initializeCoreSchema` creates the full current tables on a fresh database
 * (and is harmless on an existing one). Migration 1 is the legacy reconcile:
 * every column add, backfill and one-off data fix that used to be re-probed
 * on every startup, rewritten to be idempotent. Fresh databases no-op through
 * it and record the version; legacy databases converge to the current shape
 * exactly once.
 */
import type Database from 'better-sqlite3';
import { homedir } from 'os';
import path from 'path';

import {
  AgentId,
  DefaultAgentAvatarIcon,
  DefaultAgentProfile,
  LegacyAgentName,
  normalizeAgentAvatarIcon,
} from '../shared/agent';
import { CoworkScheduledSessionTitlePrefix, CoworkSessionSource } from '../shared/cowork/constants';
import { addColumnIfMissing, runMigrations, type Migration } from './sqliteMigrations';
import { normalizeWorkspacePath, workspaceIdForPath, workspaceNameForPath } from './workspaceUtils';
import { migrateScheduledSessionTitles } from './scheduledSessionTitles/migration';
import {
  initializeArtifactLedgerSchema,
  migrateLegacyArtifactsToLedger,
} from './artifactLedger/schema';
import { normalizeArtifactKeyPath } from './artifactLedger/artifactLedger';

export const AGENT_WORKING_DIRECTORY_BACKFILL_KEY = 'agents.workingDirectoryBackfill.v1.completed';

export function initializeCoreSchema(): string {
  return `
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      title_user_renamed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle',
      pinned INTEGER NOT NULL DEFAULT 0,
      pin_order INTEGER,
      cwd TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      model_override TEXT NOT NULL DEFAULT '',
      execution_mode TEXT,
      workspace_id TEXT,
      source TEXT NOT NULL DEFAULT '${CoworkSessionSource.Manual}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_folders (
      workspace_id TEXT NOT NULL,
      path TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_folders_workspace ON workspace_folders(workspace_id);

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
    CREATE INDEX IF NOT EXISTS idx_cowork_messages_session_id ON cowork_messages(session_id);

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
    CREATE INDEX IF NOT EXISTS idx_cowork_session_experts_session_id
      ON cowork_session_experts(session_id, created_at);

    CREATE TABLE IF NOT EXISTS cowork_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

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
      mcp_ids TEXT NOT NULL DEFAULT '[]',
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

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      transport_type TEXT NOT NULL DEFAULT 'stdio',
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

function rebuildWorkspacesWithoutUniquePath(db: Database.Database): void {
  db.exec(`
    CREATE TABLE workspaces_rebuilt (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO workspaces_rebuilt (id, name, path, is_hidden, created_at, updated_at)
    SELECT id, name, path, is_hidden, created_at, updated_at FROM workspaces;
    DROP TABLE workspaces;
    ALTER TABLE workspaces_rebuilt RENAME TO workspaces;
  `);
}

function hasUniqueWorkspacePathIndex(db: Database.Database): boolean {
  const indexes = db.pragma('index_list(workspaces)') as Array<{
    name: string;
    unique: number;
  }>;
  return indexes.some(index => {
    if (index.unique !== 1) return false;
    const columns = db.pragma(`index_info(${index.name})`) as Array<{ name: string }>;
    return columns.length === 1 && columns[0].name === 'path';
  });
}

function backfillSessionWorkspaceIds(db: Database.Database): void {
  const fallbackWorkspacePath = path.join(homedir(), 'zhiyuan', 'project');
  const legacySessions = db
    .prepare(
      "SELECT id, cwd FROM cowork_sessions WHERE workspace_id IS NULL OR TRIM(workspace_id) = ''",
    )
    .all() as Array<{ id: string; cwd: string }>;
  if (legacySessions.length === 0) return;

  const insertWorkspace = db.prepare(
    `INSERT INTO workspaces (id, name, path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
  );
  const updateSessionWorkspace = db.prepare(
    'UPDATE cowork_sessions SET workspace_id = ? WHERE id = ?',
  );
  const now = Date.now();
  for (const session of legacySessions) {
    const workspacePath = normalizeWorkspacePath(session.cwd?.trim() || fallbackWorkspacePath);
    const workspaceId = workspaceIdForPath(workspacePath);
    insertWorkspace.run(workspaceId, workspaceNameForPath(workspacePath), workspacePath, now, now);
    updateSessionWorkspace.run(workspaceId, session.id);
  }
}

function normalizePinState(db: Database.Database, table: string): void {
  db.prepare(`UPDATE ${table} SET pinned = 0 WHERE pinned IS NULL;`).run();
  db.prepare(
    `UPDATE ${table} SET pin_order = updated_at WHERE pinned = 1 AND pin_order IS NULL;`,
  ).run();
  db.prepare(
    `UPDATE ${table} SET pin_order = NULL WHERE pinned = 0 AND pin_order IS NOT NULL;`,
  ).run();
}

function ensureDefaultAgent(db: Database.Database): void {
  const mainAgent = db
    .prepare('SELECT id, name FROM agents WHERE id = ?')
    .get(AgentId.Main) as { id: string; name: string } | undefined;
  if (!mainAgent) {
    const now = Date.now();
    // Read existing systemPrompt from cowork_config to inherit into main agent.
    const spRow = db
      .prepare("SELECT value FROM cowork_config WHERE key = 'systemPrompt'")
      .get() as { value: string } | undefined;
    const existingSystemPrompt = spRow?.value ?? '';
    db.prepare(
      `
      INSERT INTO agents (id, name, description, system_prompt, identity, model, icon, skill_ids, enabled, is_default, source, preset_id, created_at, updated_at)
      VALUES (?, ?, '', ?, '', '', ?, '[]', 1, 1, 'custom', '', ?, ?)
    `,
    ).run(
      AgentId.Main,
      DefaultAgentProfile.Name,
      existingSystemPrompt,
      DefaultAgentAvatarIcon,
      now,
      now,
    );
    return;
  }
  const normalizedName = mainAgent.name.trim();
  const shouldUpgradeName =
    !normalizedName || normalizedName.toLowerCase() === LegacyAgentName.Main;
  if (shouldUpgradeName) {
    db.prepare('UPDATE agents SET name = ?, updated_at = ? WHERE id = ?').run(
      DefaultAgentProfile.Name,
      Date.now(),
      AgentId.Main,
    );
  }
}

function migrateAgentAvatarIcons(db: Database.Database): void {
  const rows = db.prepare('SELECT id, icon FROM agents').all() as Array<{
    id: string;
    icon: string;
  }>;
  const updates = rows
    .map(row => ({ id: row.id, icon: normalizeAgentAvatarIcon(row.icon) }))
    .filter((row, index) => row.icon !== rows[index].icon);
  if (updates.length === 0) return;

  const now = Date.now();
  const updateIcon = db.prepare('UPDATE agents SET icon = ?, updated_at = ? WHERE id = ?');
  for (const agent of updates) {
    updateIcon.run(agent.icon, now, agent.id);
  }
}

function backfillAgentWorkingDirectories(db: Database.Database): void {
  const completed = db
    .prepare('SELECT value FROM kv WHERE key = ?')
    .get(AGENT_WORKING_DIRECTORY_BACKFILL_KEY) as { value: string } | undefined;
  if (completed?.value === JSON.stringify('1')) return;

  const cwdRow = db
    .prepare("SELECT value FROM cowork_config WHERE key = 'workingDirectory'")
    .get() as { value: string } | undefined;
  const legacyWorkingDirectory = cwdRow?.value?.trim() || '';
  if (legacyWorkingDirectory) {
    db.prepare(
      `UPDATE agents
       SET working_directory = ?, updated_at = ?
       WHERE TRIM(COALESCE(working_directory, '')) = ''`,
    ).run(legacyWorkingDirectory, Date.now());
  }
  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(AGENT_WORKING_DIRECTORY_BACKFILL_KEY, JSON.stringify('1'), Date.now());
}

function backfillScheduledSessionSource(db: Database.Database): void {
  const prefixes = Object.values(CoworkScheduledSessionTitlePrefix);
  db.prepare(
    `
      UPDATE cowork_sessions
      SET source = ?
      WHERE ${prefixes.map(() => 'TRIM(title) LIKE ?').join(' OR ')}
    `,
  ).run(CoworkSessionSource.Scheduled, ...prefixes.map(prefix => `${prefix}%`));
}

/**
 * Legacy reconcile: converges any partially-migrated installation to the
 * current schema. Idempotent by construction (column probes + guarded
 * UPDATEs), so a fresh database runs through it as a no-op.
 */
function reconcileLegacyCoreSchema(db: Database.Database): void {
  // cowork_sessions columns added across releases.
  addColumnIfMissing(db, 'cowork_sessions', 'execution_mode', 'TEXT');
  addColumnIfMissing(db, 'cowork_sessions', 'title_user_renamed', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'cowork_sessions', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'cowork_sessions', 'pin_order', 'INTEGER');
  addColumnIfMissing(db, 'cowork_sessions', 'active_skill_ids', 'TEXT');
  addColumnIfMissing(db, 'cowork_sessions', 'model_override', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'cowork_sessions', 'agent_id', "TEXT NOT NULL DEFAULT 'main'");
  addColumnIfMissing(db, 'cowork_sessions', 'mode', "TEXT NOT NULL DEFAULT 'work'");
  addColumnIfMissing(db, 'cowork_sessions', 'workspace_id', 'TEXT');
  const addedSource = addColumnIfMissing(
    db,
    'cowork_sessions',
    'source',
    `TEXT NOT NULL DEFAULT '${CoworkSessionSource.Manual}'`,
  );

  // Sequence ordering for cowork_messages, with the legacy backfill.
  const addedSequence = addColumnIfMissing(db, 'cowork_messages', 'sequence', 'INTEGER');
  if (addedSequence) {
    db.exec(`
      WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY session_id
          ORDER BY created_at ASC, ROWID ASC
        ) as seq
        FROM cowork_messages
      )
      UPDATE cowork_messages
      SET sequence = (SELECT seq FROM numbered WHERE numbered.id = cowork_messages.id)
    `);
  }

  // Backfill the source of scheduled sessions only when the column was just
  // added; on databases that predate it the old heuristic marks them.
  if (addedSource) {
    backfillScheduledSessionSource(db);
  }

  addColumnIfMissing(db, 'workspaces', 'is_hidden', 'INTEGER NOT NULL DEFAULT 0');
  if (hasUniqueWorkspacePathIndex(db)) {
    rebuildWorkspacesWithoutUniquePath(db);
  }
  backfillSessionWorkspaceIds(db);

  // Agents columns and derived data.
  addColumnIfMissing(db, 'agents', 'working_directory', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'agents', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'agents', 'pin_order', 'INTEGER');
  addColumnIfMissing(db, 'agents', 'triage_override', 'TEXT');
  addColumnIfMissing(db, 'agents', 'mcp_ids', "TEXT NOT NULL DEFAULT '[]'");

  normalizePinState(db, 'cowork_sessions');
  normalizePinState(db, 'agents');
  ensureDefaultAgent(db);
  migrateAgentAvatarIcons(db);
  backfillAgentWorkingDirectories(db);

  // Legacy tables and one-off data migrations previously re-checked each boot.
  db.exec(`
    DROP TABLE IF EXISTS user_memory_sources;
    DROP TABLE IF EXISTS user_memories;
  `);
  migrateScheduledSessionTitles(db);
  migrateLegacyArtifactsToLedger(db, normalizeArtifactKeyPath);
}

export function coreMigrations(): Migration[] {
  return [
    {
      version: 1,
      name: 'legacy-reconcile',
      up: reconcileLegacyCoreSchema,
    },
  ];
}

/**
 * Apply the cowork-core schema: current-shape DDL, versioned migrations, then
 * the indexes whose expressions depend on migrated columns. The message-order
 * index references `sequence`, which on legacy databases only exists after
 * migration 1; creating it earlier fails with "no such column: sequence".
 */
export function applyCoreSchema(db: Database.Database): void {
  db.exec(initializeCoreSchema());
  db.exec('CREATE INDEX IF NOT EXISTS idx_workspaces_path ON workspaces(path);');
  runMigrations(db, 'core', coreMigrations());
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cowork_messages_session_order
    ON cowork_messages(session_id, COALESCE(sequence, created_at), created_at);
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_cowork_sessions_workspace_id ON cowork_sessions(workspace_id);',
  );
  initializeArtifactLedgerSchema(db);
}
