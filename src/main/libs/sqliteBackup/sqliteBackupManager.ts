import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { DB_FILENAME } from '../../appConstants';
import {
  PI_COMPANION_SESSIONS_ROOT_DIR,
  PI_SESSIONS_ROOT_DIR,
} from '../agentEngine/piSessionStore';
import { sha256FileStream } from '../fileHasher';
import {
  SQLITE_BACKUP_ALWAYS_ON_STARTUP_ENV,
  SQLITE_BACKUP_DIR_NAME,
  SQLITE_BACKUP_FILE_NAME,
  SQLITE_BACKUP_HEALTH_OK,
  SQLITE_BACKUP_INTERVAL_MS,
  SQLITE_BACKUP_MANIFEST_FILE_NAME,
  SQLITE_BACKUP_MANIFEST_VERSION,
  SQLITE_BACKUP_MAX_SNAPSHOT_BYTES,
  SQLITE_BACKUP_QUARANTINE_DIR_NAME,
  SQLITE_BACKUP_RETENTION_COUNT,
  SQLITE_BACKUP_SNAPSHOTS_DIR_NAME,
  type SqliteBackupManifest,
  type SqliteBackupRecord,
  SqliteBackupTrigger,
  type SqliteBackupTrigger as SqliteBackupTriggerType,
} from './constants';
import { verifySqliteFile } from './sqliteVerify';

export type SqliteBackupPaths = {
  backupDir: string;
  snapshotsDir: string;
  quarantineDir: string;
  manifestPath: string;
};

export type SqliteHealthCheckResult = { ok: true } | { ok: false; reason: string };

export type SqliteRestoreResult = {
  restored: boolean;
  snapshotFileName?: string;
};

type SqliteBackupProgress = {
  totalPages: number;
  remainingPages: number;
};

const SQLITE_BACKUP_PROGRESS_PAGE_RATE = 100;

const SINGLE_BACKUP_FILE_NAME = SQLITE_BACKUP_FILE_NAME;

const applyRecommendedPragmas = (db: Database.Database): void => {
  // WAL mode: persists across connections, never reverts. NORMAL sync is safe under WAL
  // (no data loss on OS crash; power-loss risk is the same as DELETE mode).
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -8000'); // 8 MB; negative value = kibibytes
  db.pragma('wal_autocheckpoint = 1000'); // checkpoint every ~4 MB of WAL writes
};

const isSqliteCorruptionCode = (error: unknown): boolean => {
  if (!(error instanceof Error) || !('code' in error)) return false;
  return (
    typeof error.code === 'string' && /^(SQLITE_CORRUPT(?:_|$)|SQLITE_NOTADB$)/.test(error.code)
  );
};

const isRecoverableSqliteStartupError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { message?: string };
  if (isSqliteCorruptionCode(error)) return true;
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
  return (
    message.includes('database disk image is malformed') ||
    message.includes('file is not a database') ||
    message.includes('malformed')
  );
};

const fileExists = (filePath: string): boolean => {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
};

const removeFileIfExists = (filePath: string): void => {
  if (!fileExists(filePath)) return;
  fs.rmSync(filePath, { force: true });
};

const ensureDir = (dirPath: string): void => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const padTimestampSegment = (value: number, width = 2): string => {
  return value.toString().padStart(width, '0');
};

export const formatTimestampForLocalPath = (value: number): string => {
  const date = new Date(value);
  return (
    [
      padTimestampSegment(date.getFullYear(), 4),
      padTimestampSegment(date.getMonth() + 1),
      padTimestampSegment(date.getDate()),
    ].join('-') +
    'T' +
    [
      padTimestampSegment(date.getHours()),
      padTimestampSegment(date.getMinutes()),
      padTimestampSegment(date.getSeconds()),
    ].join('-') +
    '-' +
    padTimestampSegment(date.getMilliseconds(), 3)
  );
};

/** Streaming hash in the shared worker; the main thread never reads the file. */
const computeFileSha256 = (filePath: string): Promise<string> =>
  sha256FileStream(filePath, { maxBytes: SQLITE_BACKUP_MAX_SNAPSHOT_BYTES });

export const buildSqliteBackupPaths = (userDataPath: string): SqliteBackupPaths => {
  const backupDir = path.join(userDataPath, SQLITE_BACKUP_DIR_NAME);
  return {
    backupDir,
    snapshotsDir: path.join(backupDir, SQLITE_BACKUP_SNAPSHOTS_DIR_NAME),
    quarantineDir: path.join(backupDir, SQLITE_BACKUP_QUARANTINE_DIR_NAME),
    manifestPath: path.join(backupDir, SQLITE_BACKUP_MANIFEST_FILE_NAME),
  };
};

export const retainLatestSnapshots = (
  records: SqliteBackupRecord[],
): { retained: SqliteBackupRecord[]; removed: SqliteBackupRecord[] } => {
  const sorted = [...records].sort((left, right) => right.createdAt - left.createdAt);
  return {
    retained: sorted.slice(0, SQLITE_BACKUP_RETENTION_COUNT),
    removed: sorted.slice(SQLITE_BACKUP_RETENTION_COUNT),
  };
};

const emptyManifest = (): SqliteBackupManifest => ({
  version: SQLITE_BACKUP_MANIFEST_VERSION,
  snapshots: [],
  updatedAt: Date.now(),
});

const isTruthyEnvValue = (value: string | undefined): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
};

const buildSingleBackupRecord = (record: SqliteBackupRecord): SqliteBackupRecord => ({
  ...record,
  fileName: SINGLE_BACKUP_FILE_NAME,
});

const buildBackupSwapPath = (backupFilePath: string): string => `${backupFilePath}.previous`;

const resolveBackupRestorePath = (backupFilePath: string): string | null => {
  if (fileExists(backupFilePath)) {
    return backupFilePath;
  }
  const swapPath = buildBackupSwapPath(backupFilePath);
  if (fileExists(swapPath)) {
    return swapPath;
  }
  return null;
};

export class SqliteBackupManager {
  private userDataPath: string;
  private periodicTimer: NodeJS.Timeout | null = null;
  private periodicBackup: Promise<SqliteBackupRecord> | null = null;
  private readonly sourceCopies = new Set<Promise<Database.BackupMetadata>>();
  private shuttingDown = false;

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath;
  }

  getPaths(): SqliteBackupPaths {
    return buildSqliteBackupPaths(this.userDataPath);
  }

  readManifest(): SqliteBackupManifest {
    const { manifestPath } = this.getPaths();
    if (!fileExists(manifestPath)) {
      return emptyManifest();
    }

    try {
      const parsed = JSON.parse(
        fs.readFileSync(manifestPath, 'utf8'),
      ) as Partial<SqliteBackupManifest>;
      if (!Array.isArray(parsed.snapshots)) {
        return emptyManifest();
      }
      return {
        version: SQLITE_BACKUP_MANIFEST_VERSION,
        snapshots: parsed.snapshots
          .filter((item): item is SqliteBackupRecord => Boolean(item?.fileName))
          .sort((left, right) => right.createdAt - left.createdAt),
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      };
    } catch (error) {
      console.warn('[SqliteBackup] Failed to read backup manifest, using empty state:', error);
      return emptyManifest();
    }
  }

  async verifyDatabaseHealth(dbFilePath: string): Promise<SqliteHealthCheckResult> {
    try {
      const { check: quickCheck } = await verifySqliteFile(dbFilePath, 'quick_check');
      if (quickCheck === SQLITE_BACKUP_HEALTH_OK) {
        return { ok: true };
      }
      return { ok: false, reason: quickCheck || 'quick_check returned an empty result' };
    } catch (error) {
      if (!isSqliteCorruptionCode(error)) throw error;
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'quick_check failed',
      };
    }
  }

  async createBackup(input: {
    db: Database.Database;
    trigger: SqliteBackupTriggerType;
  }): Promise<SqliteBackupRecord> {
    if (this.shuttingDown) throw new Error('SQLite backup is shutting down.');
    const { snapshotsDir } = this.getPaths();
    ensureDir(snapshotsDir);

    const createdAt = Date.now();
    const id = crypto.randomUUID();
    const tempFileName = `.tmp-${id}.sqlite`;
    const tempFilePath = path.join(snapshotsDir, tempFileName);
    const finalFileName = SINGLE_BACKUP_FILE_NAME;
    const finalFilePath = path.join(snapshotsDir, finalFileName);

    console.log(`[SqliteBackup] Starting ${input.trigger} backup to ${finalFileName}`);

    try {
      const copying = input.db.backup(tempFilePath, {
        progress: (progress: SqliteBackupProgress) => {
          const transferredPages = Math.max(0, progress.totalPages - progress.remainingPages);
          console.debug(
            `[SqliteBackup] Backup progress: transferred ${transferredPages}/${progress.totalPages} pages, ${progress.remainingPages} remaining`,
          );
          return SQLITE_BACKUP_PROGRESS_PAGE_RATE;
        },
      });
      this.sourceCopies.add(copying);
      try {
        await copying;
      } finally {
        this.sourceCopies.delete(copying);
      }

      // Off-thread verification: quick_check walks every page of the temp
      // snapshot, which must not block the main-process event loop.
      const verification = await verifySqliteFile(tempFilePath, 'quick_check');
      const {
        check: quickCheck,
        userVersion: sourceUserVersion,
        schemaVersion: sourceSchemaVersion,
      } = verification;

      if (quickCheck !== SQLITE_BACKUP_HEALTH_OK) {
        throw new Error(`Backup quick_check failed: ${quickCheck}`);
      }

      const stat = await fs.promises.stat(tempFilePath);
      const record = buildSingleBackupRecord({
        id,
        fileName: finalFileName,
        createdAt,
        trigger: input.trigger,
        sizeBytes: stat.size,
        checksumSha256: await computeFileSha256(tempFilePath),
        quickCheck: 'ok',
        sourceUserVersion,
        sourceSchemaVersion,
        restoreTested: false,
      });

      this.publishBackup(tempFilePath, finalFilePath, record);
      console.log(`[SqliteBackup] Completed ${input.trigger} backup to ${finalFileName}`);
      return record;
    } catch (error) {
      removeFileIfExists(tempFilePath);
      console.error('[SqliteBackup] Backup creation failed:', error);
      throw error;
    }
  }

  async restoreLatestBackup(dbFilePath: string): Promise<SqliteRestoreResult> {
    const manifest = this.readManifest();
    const { snapshotsDir, quarantineDir } = this.getPaths();
    const quarantineStamp = formatTimestampForLocalPath(Date.now());
    ensureDir(quarantineDir);
    const quarantineTargetDir = fs.mkdtempSync(path.join(quarantineDir, `${quarantineStamp}-`));
    this.quarantineRecoveryFiles(dbFilePath, quarantineTargetDir);

    for (const snapshot of manifest.snapshots.sort(
      (left, right) => right.createdAt - left.createdAt,
    )) {
      const snapshotPath = resolveBackupRestorePath(path.join(snapshotsDir, snapshot.fileName));
      if (!snapshotPath) continue;

      try {
        await fs.promises.mkdir(path.dirname(dbFilePath), { recursive: true });
        await fs.promises.copyFile(snapshotPath, dbFilePath);
        removeFileIfExists(`${dbFilePath}-wal`);
        removeFileIfExists(`${dbFilePath}-shm`);

        // Off-thread integrity_check on the restored file (reads every page).
        const verification = await verifySqliteFile(dbFilePath, 'integrity_check');

        if (verification.check !== SQLITE_BACKUP_HEALTH_OK) {
          throw new Error(`integrity_check failed: ${verification.check}`);
        }

        this.markSnapshotAsRestoreTested(snapshot.fileName);
        fs.writeFileSync(
          path.join(quarantineTargetDir, 'restore-context.json'),
          JSON.stringify(
            {
              restoredSnapshot: snapshot.fileName,
              restoredAt: Date.now(),
            },
            null,
            2,
          ),
          'utf8',
        );
        console.log(`[SqliteBackup] Restored database from snapshot ${snapshot.fileName}`);
        return { restored: true, snapshotFileName: snapshot.fileName };
      } catch (error) {
        console.warn(`[SqliteBackup] Failed to restore snapshot ${snapshot.fileName}:`, error);
        removeFileIfExists(dbFilePath);
      }
    }

    return { restored: false };
  }

  shouldCreatePeriodicBackup(now = Date.now()): boolean {
    if (isTruthyEnvValue(process.env[SQLITE_BACKUP_ALWAYS_ON_STARTUP_ENV])) {
      console.log(
        `[SqliteBackup] Forced startup backup is enabled via ${SQLITE_BACKUP_ALWAYS_ON_STARTUP_ENV}`,
      );
      return true;
    }
    const latest = this.readManifest().snapshots[0];
    if (!latest) return true;
    const backupPath = path.join(this.getPaths().snapshotsDir, latest.fileName);
    if (!resolveBackupRestorePath(backupPath)) {
      console.warn('[SqliteBackup] Backup file is missing; scheduling a replacement backup');
      return true;
    }
    return now - latest.createdAt >= SQLITE_BACKUP_INTERVAL_MS;
  }

  async startPeriodicBackupLoop(getDb: () => Database.Database): Promise<void> {
    if (this.shuttingDown) return;
    this.stopPeriodicBackupLoop();
    this.periodicTimer = setInterval(() => {
      if (!this.shouldCreatePeriodicBackup()) return;
      void this.runPeriodicBackup(getDb).catch(error => {
        console.error('[SqliteBackup] Periodic backup failed:', error);
      });
    }, SQLITE_BACKUP_INTERVAL_MS);
    if (this.shouldCreatePeriodicBackup()) await this.runPeriodicBackup(getDb);
  }

  stopPeriodicBackupLoop(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  shutdown() {
    this.shuttingDown = true;
    this.stopPeriodicBackupLoop();
    return {
      sourceReleased: Promise.allSettled(this.sourceCopies),
      finished: this.periodicBackup ?? undefined,
    };
  }

  private runPeriodicBackup(getDb: () => Database.Database): Promise<SqliteBackupRecord> {
    this.periodicBackup ??= this.createBackup({
      db: getDb(),
      trigger: SqliteBackupTrigger.Periodic,
    }).finally(() => {
      this.periodicBackup = null;
    });
    return this.periodicBackup;
  }

  private publishBackup(
    tempFilePath: string,
    finalFilePath: string,
    record: SqliteBackupRecord,
  ): void {
    const swapFilePath = buildBackupSwapPath(finalFilePath);
    if (fileExists(finalFilePath)) {
      removeFileIfExists(swapFilePath);
      fs.renameSync(finalFilePath, swapFilePath);
    }

    try {
      fs.renameSync(tempFilePath, finalFilePath);
      this.writeManifest({
        version: SQLITE_BACKUP_MANIFEST_VERSION,
        snapshots: [record],
        updatedAt: Date.now(),
      });
    } catch (error) {
      try {
        removeFileIfExists(finalFilePath);
        if (fileExists(swapFilePath)) fs.renameSync(swapFilePath, finalFilePath);
      } catch (restoreError) {
        console.error(
          '[SqliteBackup] Failed to restore previous backup after publish error:',
          restoreError,
        );
      }
      throw error;
    }

    try {
      removeFileIfExists(swapFilePath);
    } catch (error) {
      console.warn('[SqliteBackup] Failed to remove previous snapshot after publish:', error);
    }
  }

  private writeManifest(manifest: SqliteBackupManifest): void {
    const { backupDir, manifestPath, snapshotsDir } = this.getPaths();
    ensureDir(backupDir);
    ensureDir(snapshotsDir);

    const { retained, removed } = retainLatestSnapshots(manifest.snapshots);
    const nextManifest: SqliteBackupManifest = {
      version: SQLITE_BACKUP_MANIFEST_VERSION,
      snapshots: retained,
      updatedAt: Date.now(),
    };
    const tempManifestPath = `${manifestPath}.tmp`;
    fs.writeFileSync(tempManifestPath, JSON.stringify(nextManifest, null, 2), 'utf8');
    fs.renameSync(tempManifestPath, manifestPath);
    for (const record of removed) {
      if (record.fileName !== SINGLE_BACKUP_FILE_NAME) {
        removeFileIfExists(path.join(snapshotsDir, record.fileName));
      }
    }
  }

  private quarantineRecoveryFiles(dbFilePath: string, quarantineTargetDir: string): void {
    const candidates = [`${dbFilePath}-wal`, `${dbFilePath}-shm`, dbFilePath];
    if (path.resolve(dbFilePath) === path.resolve(this.userDataPath, DB_FILENAME)) {
      // Keep native histories from being paired with an older or empty display database.
      candidates.unshift(
        path.join(this.userDataPath, PI_SESSIONS_ROOT_DIR),
        path.join(this.userDataPath, PI_COMPANION_SESSIONS_ROOT_DIR),
      );
    }
    const moved: Array<{ original: string; archived: string }> = [];
    for (const original of candidates) {
      const archived = path.join(quarantineTargetDir, path.basename(original));
      try {
        fs.renameSync(original, archived);
        moved.push({ original, archived });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        for (const entry of moved.reverse()) {
          try {
            fs.renameSync(entry.archived, entry.original);
          } catch (rollbackError) {
            console.error('[SqliteBackup] Failed to roll back a quarantined path:', rollbackError);
          }
        }
        throw error;
      }
    }
  }

  private markSnapshotAsRestoreTested(fileName: string): void {
    const manifest = this.readManifest();
    const snapshots = manifest.snapshots.map(snapshot =>
      snapshot.fileName === fileName ? { ...snapshot, restoreTested: true } : snapshot,
    );
    this.writeManifest({
      ...manifest,
      snapshots,
      updatedAt: Date.now(),
    });
  }
}

const getSqliteMainDbPath = (userDataPath: string): string => {
  return path.join(userDataPath, DB_FILENAME);
};

export const openSqliteDatabaseWithRecovery = async (
  userDataPath: string,
  dbFilePath = getSqliteMainDbPath(userDataPath),
): Promise<Database.Database> => {
  let db: Database.Database | null = null;

  try {
    db = new Database(dbFilePath);
    applyRecommendedPragmas(db);
    return db;
  } catch (error) {
    try {
      db?.close();
    } catch {
      // Ignore close failures during recovery.
    }

    if (!isRecoverableSqliteStartupError(error)) {
      throw error;
    }

    console.warn('[SqliteBackup] SQLite startup failed; attempting snapshot recovery:', error);
    const backupManager = new SqliteBackupManager(userDataPath);
    const restoreResult = await backupManager.restoreLatestBackup(dbFilePath);
    if (!restoreResult.restored) {
      console.warn('[SqliteBackup] Snapshot recovery did not restore any database file');
      throw error;
    }

    const recoveredDb = new Database(dbFilePath);
    applyRecommendedPragmas(recoveredDb);
    return recoveredDb;
  }
};
