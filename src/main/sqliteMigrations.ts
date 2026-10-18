/**
 * Versioned, transactional SQLite migrations.
 *
 * Each module that owns tables in the shared database file registers an
 * independent, strictly-ordered migration list under its own scope. The
 * applied version per scope lives in `schema_migrations`, not in the
 * file-global `PRAGMA user_version` (which one number for five independent
 * module histories would force to advance in lockstep).
 *
 * Contract:
 * - A migration body and its version bump commit atomically in one
 *   transaction; a failed migration leaves no partial DDL/DML behind and the
 *   scope version stays where it was.
 * - Failures are logged with scope + version + name and rethrown. Startup
 *   treats a schema error as fatal (the app cannot run against a schema it
 *   does not expect), which is strictly safer than the previous behavior of
 *   silently skipping every migration step after the first failure.
 */
import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations';

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
      scope TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function readScopeVersion(db: Database.Database, scope: string): number {
  const row = db
    .prepare(`SELECT version FROM ${SCHEMA_MIGRATIONS_TABLE} WHERE scope = ?`)
    .get(scope) as { version: number } | undefined;
  return row?.version ?? 0;
}

function writeScopeVersion(db: Database.Database, scope: string, version: number): void {
  db.prepare(
    `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (scope, version, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(scope) DO UPDATE SET
       version = excluded.version,
       updated_at = excluded.updated_at`,
  ).run(scope, version, Date.now());
}

/**
 * Apply `migrations` newer than the scope's recorded version, in order.
 * Throws on non-increasing version numbers before touching the database and
 * rethrows any migration failure after rolling back its transaction.
 */
export function runMigrations(
  db: Database.Database,
  scope: string,
  migrations: Migration[],
): void {
  ensureMigrationsTable(db);
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index].version <= migrations[index - 1].version) {
      throw new Error(
        `[SqliteMigrations] scope ${scope}: migration versions must be strictly increasing, ` +
          `got ${migrations[index - 1].version} before ${migrations[index].version}`,
      );
    }
  }

  let current = readScopeVersion(db, scope);
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    try {
      db.transaction(() => {
        migration.up(db);
        writeScopeVersion(db, scope, migration.version);
      })();
    } catch (error) {
      console.error(
        `[SqliteMigrations] scope ${scope} migration ${migration.version} ` +
          `(${migration.name}) failed; rolled back, version stays at ${current}`,
        error,
      );
      throw error;
    }
    current = migration.version;
  }
}

/** Reads the current column names of `table` via PRAGMA table_info. */
export function tableColumnNames(db: Database.Database, table: string): Set<string> {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return new Set(columns.map(column => column.name));
}

/**
 * Adds `column` to `table` unless it already exists. The probe-based guard
 * makes legacy-reconcile migrations idempotent without swallowing errors from
 * genuinely broken DDL.
 */
export function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): boolean {
  if (tableColumnNames(db, table).has(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}
