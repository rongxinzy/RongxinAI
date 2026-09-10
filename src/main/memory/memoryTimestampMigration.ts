import type Database from 'better-sqlite3';

interface TimestampColumnTarget {
  table: string;
  columns: string[];
}

const TIMESTAMP_COLUMN_TARGETS: TimestampColumnTarget[] = [
  { table: 'memory_links', columns: ['created_at', 'updated_at', 'expires_at'] },
  { table: 'memory_candidates', columns: ['created_at', 'updated_at', 'expires_at'] },
  { table: 'memory_outbox', columns: ['created_at', 'available_at', 'completed_at'] },
  { table: 'memory_import_rejections', columns: ['rejected_at'] },
];

// Legacy rows written by SQLite datetime('now') store UTC without a zone
// marker ("YYYY-MM-DD HH:MM:SS"), which JS Date interprets as local time.
// The GLOB pattern only matches values with a space at position 11, so ISO
// values (which have a "T" there) are never touched; rewriting is idempotent.
// This mirrors normalizeMemoryTimestamp in shared/memory/timestamps.ts.
const LEGACY_DATETIME_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]*';

/**
 * Rewrite legacy SQLite datetime('now') timestamps in the memory projection
 * tables to ISO UTC. Runs on every startup; second run matches no rows.
 */
export function migrateLegacyMemoryTimestamps(db: Database.Database): void {
  if (typeof db.prepare !== 'function') return;
  for (const { table, columns } of TIMESTAMP_COLUMN_TARGETS) {
    const existingColumns = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        column => column.name,
      ),
    );
    for (const column of columns) {
      if (!existingColumns.has(column)) continue;
      db.exec(`
        UPDATE ${table}
        SET ${column} = REPLACE(${column}, ' ', 'T') || 'Z'
        WHERE ${column} GLOB '${LEGACY_DATETIME_GLOB}'
      `);
    }
  }
}
