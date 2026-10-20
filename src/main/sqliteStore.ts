import Database from 'better-sqlite3';
import { app } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';

import { DB_FILENAME } from './appConstants';
import {
  openSqliteDatabaseWithRecovery,
  SqliteBackupManager,
} from './libs/sqliteBackup/sqliteBackupManager';
import { applyCoreSchema } from './coreSchema';
import { initializeWorkbenchTaskSchema } from './workbenchTask/schema';
import { initializeCodingAgentSchema } from './codingAgent/schema';
import { initializeTodoSchema } from './todo/schema';

type ChangePayload<T = unknown> = {
  key: string;
  newValue: T | undefined;
  oldValue: T | undefined;
};

export class SqliteStore {
  private db: Database.Database;
  private dbPath: string;
  private emitter = new EventEmitter();

  private constructor(db: Database.Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  static async create(userDataPath?: string): Promise<SqliteStore> {
    const basePath = userDataPath ?? app.getPath('userData');
    const dbPath = path.join(basePath, DB_FILENAME);

    let db = await openSqliteDatabaseWithRecovery(basePath, dbPath);

    const autoBackupEnabled = SqliteStore.readSqliteAutoBackupEnabled(db);
    if (autoBackupEnabled) {
      const backupManager = new SqliteBackupManager(basePath);
      const health = backupManager.verifyDatabaseHealth(db);
      if (!health.ok) {
        const healthReason = 'reason' in health ? health.reason : 'unknown reason';
        console.warn(`[SqliteBackup] Startup health check failed: ${healthReason}`);
        try {
          db.close();
        } catch {
          // Ignore close failures before restore.
        }
        const restoreResult = await backupManager.restoreLatestBackup(dbPath);
        if (!restoreResult.restored) {
          console.warn(
            '[SqliteBackup] No valid snapshot was restored; continuing with database reinitialization',
          );
        }
        db = await openSqliteDatabaseWithRecovery(basePath, dbPath);
      }
    }

    const store = new SqliteStore(db, dbPath);
    store.initializeTables(basePath);
    return store;
  }

  private initializeTables(basePath: string) {
    applyCoreSchema(this.db, basePath);
    initializeWorkbenchTaskSchema(this.db);
    initializeCodingAgentSchema(this.db);
    initializeTodoSchema(this.db);
  }

  onDidChange<T = unknown>(
    key: string,
    callback: (newValue: T | undefined, oldValue: T | undefined) => void,
  ) {
    const handler = (payload: ChangePayload<T>) => {
      if (payload.key !== key) return;
      callback(payload.newValue, payload.oldValue);
    };
    this.emitter.on('change', handler);
    return () => this.emitter.off('change', handler);
  }

  get<T = unknown>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch (error) {
      console.warn(`Failed to parse store value for ${key}`, error);
      return undefined;
    }
  }

  set<T = unknown>(key: string, value: T): void {
    const oldValue = this.get<T>(key);
    const now = Date.now();
    this.db
      .prepare(
        `
      INSERT INTO kv (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
      )
      .run(key, JSON.stringify(value), now);
    this.emitter.emit('change', { key, newValue: value, oldValue } as ChangePayload<T>);
  }

  delete(key: string): void {
    const oldValue = this.get(key);
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
    this.emitter.emit('change', { key, newValue: undefined, oldValue } as ChangePayload);
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  close(): void {
    this.db.close();
  }

  private static readSqliteAutoBackupEnabled(db: Database.Database): boolean {
    try {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'app_config'").get() as
        | { value: string }
        | undefined;
      if (!row?.value) return false;
      const parsed = JSON.parse(row.value) as { sqliteAutoBackupEnabled?: boolean };
      return parsed.sqliteAutoBackupEnabled === true;
    } catch {
      return false;
    }
  }
}
