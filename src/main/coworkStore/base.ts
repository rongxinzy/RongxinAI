// SQLite plumbing and repository handles shared by the CoworkStore class chain.
// Split from src/main/coworkStore.ts (issue #1069).
import Database from 'better-sqlite3';

import { CoworkArtifactIndex } from '../coworkArtifactIndex';
import { WorkspaceFolderRepository } from '../workspaceFolderRepository';

export class CoworkStoreBase {
  protected db: Database.Database;
  protected artifactIndex: CoworkArtifactIndex;
  protected workspaceFolders: WorkspaceFolderRepository;

  constructor(db: Database.Database) {
    this.db = db;
    this.artifactIndex = new CoworkArtifactIndex(db);
    this.workspaceFolders = new WorkspaceFolderRepository(db);
  }

  protected getOne<T>(sql: string, params: (string | number | null)[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  protected getAll<T>(sql: string, params: (string | number | null)[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  protected upsertConfig(key: string, value: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO cowork_config (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, value, now);
  }

  protected tableExists(tableName: string): boolean {
    const row = this.getOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName],
    );
    return row !== undefined;
  }
}
