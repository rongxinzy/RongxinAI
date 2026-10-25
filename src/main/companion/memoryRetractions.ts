import type Database from 'better-sqlite3';

/** Retains only request hashes so retries cannot recreate explicitly withdrawn private writes. */
export class CompanionMemoryRetractions {
  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS companion_memory_retractions (
      id TEXT PRIMARY KEY, withdrawn_at TEXT NOT NULL
    )`);
  }

  has(id: string): boolean {
    return Boolean(
      this.db.prepare('SELECT 1 FROM companion_memory_retractions WHERE id = ?').get(id),
    );
  }

  add(id: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO companion_memory_retractions (id, withdrawn_at) VALUES (?, ?)',
      )
      .run(id, new Date().toISOString());
  }
}
