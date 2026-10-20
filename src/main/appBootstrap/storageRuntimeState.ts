import type { SqliteBackupManager } from '../libs/sqliteBackup/sqliteBackupManager';
import type { ArtifactLedger } from '../artifactLedger/artifactLedger';
import type { CoworkStore } from '../coworkStore';
import type { SqliteStore } from '../sqliteStore';

/**
 * Storage domain state carved out of the shared `rt` locator (work package
 * I.1): the main SQLite store and its init promise, the backup manager, the
 * cowork store and the artifact ledger. Initialized lazily by initApp.
 */
export interface StorageRuntimeState {
  store: SqliteStore | null;
  storeInitPromise: Promise<SqliteStore> | null;
  sqliteBackupManager: SqliteBackupManager | null;
  coworkStore: CoworkStore | null;
  artifactLedger: ArtifactLedger | null;
}

export const storageRuntime: StorageRuntimeState = {
  store: null,
  storeInitPromise: null,
  sqliteBackupManager: null,
  coworkStore: null,
  artifactLedger: null,
};
