import type Database from 'better-sqlite3';

import {
  CoworkScheduledSessionTitlePrefix,
  CoworkSessionSource,
} from '../../shared/cowork/constants';
import { ScheduledTitleMigration } from './constants';

/** SQLite ownership stays on the main thread; no file scanning or JS row materialization. */
export function migrateScheduledSessionTitles(db: Database.Database): void {
  const completed = db
    .prepare<[string], { value: string }>('SELECT value FROM kv WHERE key = ?')
    .get(ScheduledTitleMigration.Key);
  if (completed?.value === JSON.stringify(ScheduledTitleMigration.Completed)) return;

  const legacy = CoworkScheduledSessionTitlePrefix.Legacy;
  db.transaction(() => {
    // Original strings and the completion marker commit with the title update.
    // A failed migration leaves neither partial changes nor a false completion.
    db.exec(`
      CREATE TABLE IF NOT EXISTS cowork_scheduled_title_journal (
        session_id TEXT PRIMARY KEY,
        original_title TEXT NOT NULL,
        migrated_title TEXT NOT NULL,
        can_restore INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
      );
    `);
    db.prepare(`
      INSERT INTO cowork_scheduled_title_journal (session_id, original_title, migrated_title)
      SELECT id, title, ? || LTRIM(SUBSTR(TRIM(title), ?))
      FROM cowork_sessions
      WHERE source = ? AND SUBSTR(TRIM(title), 1, ?) = ?
    `).run(
      CoworkScheduledSessionTitlePrefix.Chinese,
      legacy.length + 1,
      CoworkSessionSource.Scheduled,
      legacy.length,
      legacy,
    );
    db.exec(`
      UPDATE cowork_sessions
      SET title = (
        SELECT migrated_title FROM cowork_scheduled_title_journal WHERE session_id = cowork_sessions.id
      )
      WHERE id IN (SELECT session_id FROM cowork_scheduled_title_journal);

      CREATE TRIGGER IF NOT EXISTS cowork_scheduled_title_journal_invalidate
      AFTER UPDATE OF title, source, title_user_renamed ON cowork_sessions
      WHEN NEW.title IS NOT OLD.title OR NEW.source IS NOT OLD.source
        OR NEW.title_user_renamed IS NOT OLD.title_user_renamed
      BEGIN
        UPDATE cowork_scheduled_title_journal SET can_restore = 0 WHERE session_id = NEW.id;
      END;
    `);
    db.prepare(`
      INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(
      ScheduledTitleMigration.Key,
      JSON.stringify(ScheduledTitleMigration.Completed),
      Date.now(),
    );
  })();
}
