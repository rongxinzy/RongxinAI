import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import { vi } from 'vitest';

// The real implementations spawn compiled workers (dist-electron/*.js);
// tests run the same checks in-process instead.
vi.mock('./sqliteVerify', () => ({
  verifySqliteFile: async (filePath: string, mode: string) => {
    const db = new Database(filePath, { readonly: true });
    try {
      return {
        check: String(db.prepare(`PRAGMA ${mode}`).pluck().get() ?? ''),
        userVersion: Number(db.pragma('user_version', { simple: true })) || 0,
        schemaVersion: Number(db.pragma('schema_version', { simple: true })) || 0,
      };
    } finally {
      db.close();
    }
  },
}));
vi.mock('../fileHasher', () => ({
  sha256FileStream: vi.fn(async (filePath: string) => {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
  }),
}));
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';
import { sha256FileStream } from '../fileHasher';

import {
  SQLITE_BACKUP_ALWAYS_ON_STARTUP_ENV,
  SQLITE_BACKUP_FILE_NAME,
  SQLITE_BACKUP_INTERVAL_MS,
  SqliteBackupTrigger,
} from './constants';
import {
  buildSqliteBackupPaths,
  formatTimestampForLocalPath,
  retainLatestSnapshots,
  SqliteBackupManager,
} from './sqliteBackupManager';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-sqlite-backup-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

test('retainLatestSnapshots keeps only the newest successful snapshot', () => {
  const { retained, removed } = retainLatestSnapshots([
    {
      id: '1',
      fileName: 'oldest.sqlite',
      createdAt: 1,
      trigger: SqliteBackupTrigger.Periodic,
      sizeBytes: 1,
      checksumSha256: 'a',
      quickCheck: 'ok',
      restoreTested: false,
    },
    {
      id: '2',
      fileName: 'previous.sqlite',
      createdAt: 2,
      trigger: SqliteBackupTrigger.Periodic,
      sizeBytes: 1,
      checksumSha256: 'b',
      quickCheck: 'ok',
      restoreTested: false,
    },
    {
      id: '3',
      fileName: 'newest.sqlite',
      createdAt: 3,
      trigger: SqliteBackupTrigger.Periodic,
      sizeBytes: 1,
      checksumSha256: 'c',
      quickCheck: 'ok',
      restoreTested: false,
    },
  ]);

  expect(retained.map(item => item.fileName)).toEqual(['newest.sqlite']);
  expect(removed.map(item => item.fileName)).toEqual(['previous.sqlite', 'oldest.sqlite']);
});

test('buildBackupPaths creates manifest snapshots and quarantine locations under userData', () => {
  const userDataPath = '/tmp/zhiyuan-user-data';
  const paths = buildSqliteBackupPaths(userDataPath);
  expect(paths.backupDir).toContain(path.join('backups', 'sqlite'));
  expect(paths.snapshotsDir).toContain(path.join('backups', 'sqlite', 'snapshots'));
  expect(paths.quarantineDir).toContain(path.join('backups', 'sqlite', 'quarantine'));
  expect(paths.manifestPath).toContain(path.join('backups', 'sqlite', 'manifest.json'));
});

test('createBackup writes a snapshot and a manifest record', async () => {
  const userDataPath = makeTempDir();
  const dbPath = path.join(userDataPath, 'source.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  db.prepare('INSERT INTO demo (value) VALUES (?)').run('ok');

  const manager = new SqliteBackupManager(userDataPath);
  const record = await manager.createBackup({ db, trigger: SqliteBackupTrigger.Manual });
  db.close();

  const paths = manager.getPaths();
  const snapshotPath = path.join(paths.snapshotsDir, record.fileName);
  expect(record.fileName).toBe(SQLITE_BACKUP_FILE_NAME);
  expect(fs.existsSync(snapshotPath)).toBe(true);

  const manifest = manager.readManifest();
  expect(manifest.snapshots).toHaveLength(1);
  expect(manifest.snapshots[0]?.fileName).toBe(record.fileName);

  const reopened = new Database(snapshotPath, { readonly: true });
  expect(reopened.prepare('SELECT value FROM demo WHERE id = 1').get()).toEqual({ value: 'ok' });
  reopened.close();
});

test('shutdown releases SQLite after copying while the snapshot is still being published', async () => {
  const manager = new SqliteBackupManager(makeTempDir());
  const db = new Database(':memory:');
  const entered = Promise.withResolvers<void>();
  const proceed = Promise.withResolvers<void>();
  const hashing = Promise.withResolvers<void>();
  const publish = Promise.withResolvers<void>();
  const hash = sha256FileStream;
  const hashSnapshot = vi.mocked(hash).getMockImplementation()!;
  vi.mocked(hash).mockImplementationOnce(async (...args) => {
    hashing.resolve();
    await publish.promise;
    return hashSnapshot(...args);
  });
  const originalBackup = db.backup.bind(db);
  vi.spyOn(db, 'backup').mockImplementation(async (...args) => {
    entered.resolve();
    await proceed.promise;
    return originalBackup(...args);
  });
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const starting = manager.startPeriodicBackupLoop(() => db);
    await entered.promise;
    const drained = vi.fn();
    const stopping = manager.shutdown();
    const released = stopping.sourceReleased.then(drained);
    await Promise.resolve();
    expect(drained).not.toHaveBeenCalled();
    proceed.resolve();
    await Promise.all([released, hashing.promise]);
    expect(drained).toHaveBeenCalledOnce();
    db.close();
    expect(manager.readManifest().snapshots).toEqual([]);
    publish.resolve();
    await Promise.all([starting, stopping.finished]);
    expect(manager.readManifest().snapshots).toHaveLength(1);
    await manager.startPeriodicBackupLoop(() => db);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    proceed.resolve();
    publish.resolve();
    await manager.shutdown().finished;
    vi.useRealTimers();
    if (db.open) db.close();
  }
});

test('createBackup rewrites the same backup file instead of creating a second snapshot file', async () => {
  const userDataPath = makeTempDir();
  const dbPath = path.join(userDataPath, 'source.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  db.prepare('INSERT INTO demo (value) VALUES (?)').run('first');

  const manager = new SqliteBackupManager(userDataPath);
  await manager.createBackup({ db, trigger: SqliteBackupTrigger.Manual });

  db.prepare('UPDATE demo SET value = ? WHERE id = 1').run('second');
  const secondRecord = await manager.createBackup({ db, trigger: SqliteBackupTrigger.Periodic });
  db.close();

  const paths = manager.getPaths();
  expect(fs.readdirSync(paths.snapshotsDir)).toEqual([SQLITE_BACKUP_FILE_NAME]);
  expect(manager.readManifest().snapshots).toHaveLength(1);
  expect(manager.readManifest().snapshots[0]?.fileName).toBe(SQLITE_BACKUP_FILE_NAME);
  expect(manager.readManifest().snapshots[0]?.createdAt).toBe(secondRecord.createdAt);

  const reopened = new Database(path.join(paths.snapshotsDir, SQLITE_BACKUP_FILE_NAME), {
    readonly: true,
  });
  expect(reopened.prepare('SELECT value FROM demo WHERE id = 1').get()).toEqual({
    value: 'second',
  });
  reopened.close();
});

test('createBackup removes a stale previous backup file after a successful publish', async () => {
  const userDataPath = makeTempDir();
  const dbPath = path.join(userDataPath, 'source.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  db.prepare('INSERT INTO demo (value) VALUES (?)').run('first');

  const manager = new SqliteBackupManager(userDataPath);
  await manager.createBackup({ db, trigger: SqliteBackupTrigger.Manual });

  const backupPath = path.join(manager.getPaths().snapshotsDir, SQLITE_BACKUP_FILE_NAME);
  const previousBackupPath = `${backupPath}.previous`;
  fs.copyFileSync(backupPath, previousBackupPath);

  db.prepare('UPDATE demo SET value = ? WHERE id = 1').run('second');
  await manager.createBackup({ db, trigger: SqliteBackupTrigger.Periodic });
  db.close();

  expect(fs.existsSync(previousBackupPath)).toBe(false);
});

test.each(['hash', 'manifest'] as const)(
  'a failed %s keeps the previous complete backup',
  async failure => {
    const manager = new SqliteBackupManager(makeTempDir());
    const db = new Database(':memory:');
    try {
      db.exec("CREATE TABLE demo (value TEXT); INSERT INTO demo VALUES ('first');");
      const input = { db, trigger: SqliteBackupTrigger.Periodic };
      const previous = await manager.createBackup(input);
      const paths = manager.getPaths();
      const previousPath = path.join(paths.snapshotsDir, previous.fileName);
      const firstBytes = fs.readFileSync(previousPath);
      db.exec("UPDATE demo SET value = 'replacement'");

      if (failure === 'hash')
        vi.mocked(sha256FileStream).mockRejectedValueOnce(new Error('hash failed'));
      const rename = fs.renameSync;
      const publish = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
        if (failure === 'manifest' && destination === paths.manifestPath)
          throw new Error('manifest failed');
        rename(source, destination);
      });
      try {
        await expect(manager.createBackup(input)).rejects.toThrow(`${failure} failed`);
      } finally {
        publish.mockRestore();
      }
      expect(manager.readManifest().snapshots).toEqual([previous]);
      expect(fs.readFileSync(previousPath)).toEqual(firstBytes);
      expect(fs.readdirSync(paths.snapshotsDir)).toEqual([previous.fileName]);
    } finally {
      db.close();
    }
  },
);

test('formatTimestampForLocalPath uses local timezone fields instead of UTC', () => {
  const sample = new Date(2026, 3, 20, 1, 2, 3, 45).getTime();
  expect(formatTimestampForLocalPath(sample)).toBe('2026-04-20T01-02-03-045');
});

test('shouldCreatePeriodicBackup returns true only when the latest snapshot is older than 3 days', () => {
  const userDataPath = makeTempDir();
  const manager = new SqliteBackupManager(userDataPath);
  expect(manager.shouldCreatePeriodicBackup(100)).toBe(true);

  const paths = manager.getPaths();
  fs.mkdirSync(paths.backupDir, { recursive: true });
  fs.mkdirSync(paths.snapshotsDir, { recursive: true });
  fs.writeFileSync(path.join(paths.snapshotsDir, SQLITE_BACKUP_FILE_NAME), '');
  fs.writeFileSync(
    paths.manifestPath,
    JSON.stringify({
      version: 1,
      updatedAt: SQLITE_BACKUP_INTERVAL_MS,
      snapshots: [
        {
          id: '1',
          fileName: SQLITE_BACKUP_FILE_NAME,
          createdAt: SQLITE_BACKUP_INTERVAL_MS,
          trigger: SqliteBackupTrigger.Periodic,
          sizeBytes: 1,
          checksumSha256: 'x',
          quickCheck: 'ok',
          restoreTested: false,
        },
      ],
    }),
    'utf8',
  );

  expect(manager.shouldCreatePeriodicBackup(SQLITE_BACKUP_INTERVAL_MS * 2 - 1)).toBe(false);
  expect(manager.shouldCreatePeriodicBackup(SQLITE_BACKUP_INTERVAL_MS * 2)).toBe(true);
});

test('shouldCreatePeriodicBackup returns true when manifest exists but backup file is missing', () => {
  const userDataPath = makeTempDir();
  const manager = new SqliteBackupManager(userDataPath);
  const paths = manager.getPaths();

  fs.mkdirSync(paths.backupDir, { recursive: true });
  fs.writeFileSync(
    paths.manifestPath,
    JSON.stringify({
      version: 1,
      updatedAt: SQLITE_BACKUP_INTERVAL_MS,
      snapshots: [
        {
          id: '1',
          fileName: SQLITE_BACKUP_FILE_NAME,
          createdAt: SQLITE_BACKUP_INTERVAL_MS,
          trigger: SqliteBackupTrigger.Periodic,
          sizeBytes: 1,
          checksumSha256: 'x',
          quickCheck: 'ok',
          restoreTested: false,
        },
      ],
    }),
    'utf8',
  );

  expect(manager.shouldCreatePeriodicBackup(SQLITE_BACKUP_INTERVAL_MS * 2 - 1)).toBe(true);
});

test('shouldCreatePeriodicBackup returns true when forced by QA startup env var', () => {
  const userDataPath = makeTempDir();
  const manager = new SqliteBackupManager(userDataPath);
  const previousValue = process.env[SQLITE_BACKUP_ALWAYS_ON_STARTUP_ENV];
  process.env[SQLITE_BACKUP_ALWAYS_ON_STARTUP_ENV] = '1';

  try {
    expect(manager.shouldCreatePeriodicBackup(SQLITE_BACKUP_INTERVAL_MS - 1)).toBe(true);
  } finally {
    if (previousValue === undefined) {
      delete process.env[SQLITE_BACKUP_ALWAYS_ON_STARTUP_ENV];
    } else {
      process.env[SQLITE_BACKUP_ALWAYS_ON_STARTUP_ENV] = previousValue;
    }
  }
});
