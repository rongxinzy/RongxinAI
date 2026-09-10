import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { MemoryKind, MemoryScope, MemorySourceKind } from '../../shared/memory';
import { parseMemoryTimestamp } from '../../shared/memory/timestamps';
import { MemoryOutboxOperation } from './constants';
import { MemoryRepository } from './repository';
import { migrateLegacyMemoryTimestamps } from './memoryTimestampMigration';

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function columnValue(db: Database.Database, table: string, column: string, id: string): string {
  const row = db.prepare(`SELECT ${column} AS value FROM ${table} WHERE id = ?`).get(id) as {
    value: string | null;
  };
  return row.value as string;
}

test('converts legacy datetime timestamps to ISO UTC on repository construction', () => {
  const db = new Database(':memory:');
  new MemoryRepository(db);
  db.exec(`
    UPDATE memory_links SET created_at = '2026-09-09 11:10:34', updated_at = '2026-09-09 11:10:34'
      WHERE id = 'none';
    INSERT INTO memory_links (id, memory_id, project_id, scope, session_id, source_kind, status)
      VALUES ('link-legacy', 1, 'project-a', 'session', 'session-a', 'session_summary', 'active');
    INSERT INTO memory_links (id, memory_id, project_id, scope, session_id, source_kind, status)
      VALUES ('link-iso', 2, 'project-a', 'session', 'session-b', 'session_summary', 'superseded');
    UPDATE memory_links SET created_at = '2026-09-09 11:10:34', updated_at = '2026-09-09T11:14:18.684Z'
      WHERE id = 'link-legacy';
    UPDATE memory_links SET created_at = '2026-09-09T11:10:34.000Z', updated_at = '2026-09-09T11:14:18.684Z'
      WHERE id = 'link-iso';

    INSERT INTO memory_candidates (id, session_id, source_kind, status, title, content, kind)
      VALUES ('candidate-legacy', 'session-a', 'model_proposal', 'needs_review', 'Title', 'Content', 'decision');
    UPDATE memory_candidates
      SET created_at = '2026-09-09 11:14:02', updated_at = '2026-09-09 11:14:02',
          expires_at = '2026-09-10 11:14:02'
      WHERE id = 'candidate-legacy';

    INSERT INTO memory_outbox (id, operation, payload_json, status, available_at, completed_at)
      VALUES ('outbox-legacy', 'confirm', '{}', 'completed', '2026-09-09T11:14:19.000Z', '2026-09-09 11:14:19');
    UPDATE memory_outbox SET created_at = '2026-09-09 11:14:02' WHERE id = 'outbox-legacy';

    INSERT INTO memory_import_rejections (id) VALUES ('rejection-legacy');
    UPDATE memory_import_rejections SET rejected_at = '2026-09-09 11:14:02' WHERE id = 'rejection-legacy';
  `);

  new MemoryRepository(db);

  expect(columnValue(db, 'memory_links', 'created_at', 'link-legacy')).toBe('2026-09-09T11:10:34Z');
  expect(columnValue(db, 'memory_links', 'updated_at', 'link-legacy')).toBe('2026-09-09T11:14:18.684Z');
  expect(columnValue(db, 'memory_links', 'created_at', 'link-iso')).toBe('2026-09-09T11:10:34.000Z');
  expect(columnValue(db, 'memory_candidates', 'created_at', 'candidate-legacy')).toBe('2026-09-09T11:14:02Z');
  expect(columnValue(db, 'memory_candidates', 'expires_at', 'candidate-legacy')).toBe('2026-09-10T11:14:02Z');
  expect(columnValue(db, 'memory_outbox', 'created_at', 'outbox-legacy')).toBe('2026-09-09T11:14:02Z');
  expect(columnValue(db, 'memory_outbox', 'available_at', 'outbox-legacy')).toBe('2026-09-09T11:14:19.000Z');
  expect(columnValue(db, 'memory_import_rejections', 'rejected_at', 'rejection-legacy')).toBe('2026-09-09T11:14:02Z');

  db.close();
});

test('migration is idempotent and converted values parse as UTC', () => {
  const db = new Database(':memory:');
  new MemoryRepository(db);
  db.exec(`
    INSERT INTO memory_links (id, memory_id, project_id, scope, session_id, source_kind, status)
      VALUES ('link-legacy', 1, 'project-a', 'session', 'session-a', 'session_summary', 'active');
    UPDATE memory_links SET created_at = '2026-09-09 11:10:34', updated_at = '2026-09-09 11:10:34'
      WHERE id = 'link-legacy';
  `);

  migrateLegacyMemoryTimestamps(db);
  const firstRun = columnValue(db, 'memory_links', 'created_at', 'link-legacy');
  migrateLegacyMemoryTimestamps(db);
  expect(columnValue(db, 'memory_links', 'created_at', 'link-legacy')).toBe(firstRun);

  // The SQL-side conversion must agree with the shared JS normalization so
  // migrated rows and not-yet-migrated rows render as the same instant.
  expect(parseMemoryTimestamp(firstRun)).toBe(Date.parse('2026-09-09T11:10:34Z'));
  expect(parseMemoryTimestamp('2026-09-09 11:10:34')).toBe(Date.parse('2026-09-09T11:10:34Z'));

  db.close();
});

test('skips memory tables that do not declare a timestamp column', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_links (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_candidates (id TEXT PRIMARY KEY);
    CREATE TABLE memory_outbox (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      available_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  expect(() => new MemoryRepository(db)).not.toThrow();
  db.close();
});

test('new repository writes and fresh-schema defaults produce ISO timestamps', () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);

  try {
    repository.createLink({
      id: 'link-fresh',
      memoryId: 1,
      projectId: 'project-a',
      scope: MemoryScope.Session,
      sessionId: 'session-a',
      sourceKind: MemorySourceKind.SessionSummary,
      title: 'Session summary',
      content: 'Content',
      kind: MemoryKind.SessionSummary,
    });
    repository.enqueue(MemoryOutboxOperation.Confirm, {});
    repository.recordImportRejection('rejected-1');

    expect(columnValue(db, 'memory_links', 'created_at', 'link-fresh')).toMatch(ISO_TIMESTAMP_PATTERN);
    expect(columnValue(db, 'memory_links', 'updated_at', 'link-fresh')).toMatch(ISO_TIMESTAMP_PATTERN);
    expect(
      (db.prepare("SELECT created_at AS value FROM memory_outbox WHERE id = (SELECT MIN(id) FROM memory_outbox)").get() as { value: string }).value,
    ).toMatch(ISO_TIMESTAMP_PATTERN);
    expect(columnValue(db, 'memory_import_rejections', 'rejected_at', 'rejected-1')).toMatch(
      ISO_TIMESTAMP_PATTERN,
    );

    // Fresh-schema defaults also emit ISO for rows inserted without timestamps.
    db.exec(`
      INSERT INTO memory_links (id, memory_id, project_id, scope, session_id, source_kind, status)
        VALUES ('link-default', 2, 'project-a', 'session', 'session-a', 'session_summary', 'active');
    `);
    expect(columnValue(db, 'memory_links', 'created_at', 'link-default')).toMatch(ISO_TIMESTAMP_PATTERN);
  } finally {
    db.close();
  }
});
