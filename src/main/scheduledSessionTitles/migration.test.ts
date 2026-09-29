import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { CoworkSessionSource } from '../../shared/cowork/constants';
import { ScheduledTitleMigration } from './constants';
import { migrateScheduledSessionTitles } from './migration';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL,
      title_user_renamed INTEGER NOT NULL DEFAULT 0
    );
  `);
});
afterEach(() => db.close());

function insert(id: string, title: string, source: string = CoworkSessionSource.Scheduled) {
  db.prepare('INSERT INTO cowork_sessions (id, title, source) VALUES (?, ?, ?)').run(
    id,
    title,
    source,
  );
}
function title(id: string) {
  return db
    .prepare<[string], { title: string }>('SELECT title FROM cowork_sessions WHERE id = ?')
    .get(id)?.title;
}
function rollback() {
  db.exec(
    fs.readFileSync(
      path.join(process.cwd(), 'scripts/rollback-scheduled-session-titles.sql'),
      'utf8',
    ),
  );
}

test('journals exact originals, migrates only scheduled legacy prefixes, and runs once', () => {
  insert('legacy', '  Scheduled: report  ');
  insert('manual', 'Scheduled: user title', CoworkSessionSource.Manual);
  insert('foreign', '[Cron] report');
  insert('lowercase', 'scheduled: user title');
  migrateScheduledSessionTitles(db);
  expect(title('legacy')).toBe('[定时]report');
  expect(title('manual')).toBe('Scheduled: user title');
  expect(title('foreign')).toBe('[Cron] report');
  expect(title('lowercase')).toBe('scheduled: user title');
  insert('later', 'Scheduled: later');
  migrateScheduledSessionTitles(db);
  expect(title('later')).toBe('Scheduled: later');
  rollback();
  expect(title('legacy')).toBe('  Scheduled: report  ');
  migrateScheduledSessionTitles(db);
  expect(title('legacy')).toBe('  Scheduled: report  ');
});

test('rollback preserves later renames, rename-away-and-back, new rows and other updates', () => {
  insert('untouched', 'Scheduled: original');
  insert('renamed', 'Scheduled: original');
  insert('roundtrip', 'Scheduled: original');
  insert('same-name', 'Scheduled: original');
  insert('deleted', 'Scheduled: original');
  migrateScheduledSessionTitles(db);
  const rename = db.prepare('UPDATE cowork_sessions SET title = ? WHERE id = ?');
  rename.run('[定时]custom', 'renamed');
  rename.run('[定时]custom', 'roundtrip');
  rename.run('[定时]original', 'roundtrip');
  db.prepare('UPDATE cowork_sessions SET title_user_renamed = 1 WHERE id = ?').run('same-name');
  db.prepare('DELETE FROM cowork_sessions WHERE id = ?').run('deleted');
  insert('new', '[定时]new');
  rollback();
  rollback();
  expect(title('untouched')).toBe('Scheduled: original');
  expect(title('renamed')).toBe('[定时]custom');
  expect(title('roundtrip')).toBe('[定时]original');
  expect(title('same-name')).toBe('[定时]original');
  expect(title('new')).toBe('[定时]new');
  expect(title('deleted')).toBeUndefined();
});

test('a failing completion write rolls back both titles and journal; retry succeeds', () => {
  insert('legacy', 'Scheduled: report');
  db.exec(
    `CREATE TRIGGER reject_completion BEFORE INSERT ON kv BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`,
  );
  expect(() => migrateScheduledSessionTitles(db)).toThrow('simulated failure');
  expect(title('legacy')).toBe('Scheduled: report');
  expect(
    db.prepare('SELECT value FROM kv WHERE key = ?').get(ScheduledTitleMigration.Key),
  ).toBeUndefined();
  expect(
    db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'cowork_scheduled_title_journal'")
      .get(),
  ).toBeUndefined();
  db.exec('DROP TRIGGER reject_completion;');
  migrateScheduledSessionTitles(db);
  expect(title('legacy')).toBe('[定时]report');
  rollback();
  expect(title('legacy')).toBe('Scheduled: report');
});
