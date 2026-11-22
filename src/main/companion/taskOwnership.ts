import type Database from 'better-sqlite3';

/** Use the committed admission, never a renderer-supplied pet ID or the current selection. */
export function resolveCompanionTaskOwner(db: Database.Database, sessionId: string): string | null {
  const row = db
    .prepare('SELECT pet_id FROM companion_task_admissions WHERE session_id = ?')
    .get(sessionId) as { pet_id: string } | undefined;
  return row?.pet_id ?? null;
}
