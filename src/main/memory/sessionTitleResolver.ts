import type Database from 'better-sqlite3';

import type { MemorySessionTitle } from '../../shared/memory';

const SESSION_TITLE_BATCH_SIZE = 500;

export function resolveMemorySessionTitles(
  db: Database.Database,
  rawSessionIds: readonly string[],
): MemorySessionTitle[] {
  const sessionIds = Array.from(
    new Set(rawSessionIds.map(sessionId => sessionId.trim()).filter(Boolean)),
  );
  const titles: MemorySessionTitle[] = [];

  for (let offset = 0; offset < sessionIds.length; offset += SESSION_TITLE_BATCH_SIZE) {
    const batch = sessionIds.slice(offset, offset + SESSION_TITLE_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(', ');
    const rows = db
      .prepare(`SELECT id, title FROM cowork_sessions WHERE id IN (${placeholders})`)
      .all(...batch) as Array<{ id: string; title: string }>;

    for (const row of rows) {
      const title = row.title.trim();
      if (title) titles.push({ sessionId: row.id, title });
    }
  }

  return titles;
}
