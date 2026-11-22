import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';

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
  sha256FileStream: async (filePath: string) => {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
  },
}));
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import { DB_FILENAME } from '../../appConstants';
import {
  PI_COMPANION_SESSIONS_ROOT_DIR,
  piSessionDirFor,
  resolvePiSessionStoreFile,
} from '../agentEngine/piSessionStore';
import { SqliteBackupTrigger } from './constants';
import {
  formatTimestampForLocalPath,
  openSqliteDatabaseWithRecovery,
  SqliteBackupManager,
} from './sqliteBackupManager';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-sqlite-recovery-'));
  tempDirs.push(dir);
  return dir;
};

function writePiSession(root: string, sessionId: string): string {
  const directory = piSessionDirFor(root, sessionId);
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'fixture.jsonl');
  fs.writeFileSync(filename, '{"type":"session"}\n{"type":"message","content":"After backup"}\n');
  return filename;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

test('verifyDatabaseHealth returns ok for a valid database', async () => {
  const userDataPath = makeTempDir();
  const dbPath = path.join(userDataPath, 'demo.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');

  const manager = new SqliteBackupManager(userDataPath);
  try {
    await expect(manager.verifyDatabaseHealth(dbPath)).resolves.toEqual({ ok: true });
    await expect(
      manager.verifyDatabaseHealth(path.join(userDataPath, 'missing.sqlite')),
    ).rejects.toMatchObject({
      code: 'SQLITE_CANTOPEN',
    });
  } finally {
    db.close();
  }
});

test('restoreLatestBackup replaces broken database with newest valid snapshot', async () => {
  const userDataPath = makeTempDir();
  const dbPath = path.join(userDataPath, 'demo.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  db.prepare('INSERT INTO demo (value) VALUES (?)').run('first');

  const manager = new SqliteBackupManager(userDataPath);
  await manager.createBackup({ db, trigger: SqliteBackupTrigger.Manual });
  db.close();

  fs.writeFileSync(dbPath, 'not-a-sqlite-db', 'utf8');
  fs.writeFileSync(`${dbPath}-wal`, 'wal', 'utf8');
  fs.writeFileSync(`${dbPath}-shm`, 'shm', 'utf8');
  const piSession = writePiSession(userDataPath, 'cowork');

  const restoreStamp = new Date(2026, 3, 20, 13, 14, 15, 16).getTime();
  const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(restoreStamp);

  try {
    const result = await manager.restoreLatestBackup(dbPath);
    expect(result.restored).toBe(true);

    const restoredDb = new Database(dbPath, { readonly: true });
    expect(restoredDb.prepare('SELECT value FROM demo WHERE id = 1').get()).toEqual({
      value: 'first',
    });
    restoredDb.close();

    const quarantineEntries = fs.readdirSync(manager.getPaths().quarantineDir);
    expect(quarantineEntries).toEqual([
      expect.stringContaining(`${formatTimestampForLocalPath(restoreStamp)}-`),
    ]);
    const quarantineDir = path.join(manager.getPaths().quarantineDir, quarantineEntries[0]);
    expect(fs.existsSync(path.join(quarantineDir, 'demo.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(quarantineDir, 'demo.sqlite-wal'))).toBe(true);
    expect(fs.existsSync(path.join(quarantineDir, 'demo.sqlite-shm'))).toBe(true);
    expect(fs.existsSync(piSession)).toBe(true);
  } finally {
    dateNowSpy.mockRestore();
  }
});

test('startup recovery restores SQLite and archives unmatched native history intact', async () => {
  const userDataPath = makeTempDir();
  const dbPath = path.join(userDataPath, DB_FILENAME);
  const db = new Database(dbPath);
  db.exec('CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  db.prepare('INSERT INTO demo (value) VALUES (?)').run('restored');

  const manager = new SqliteBackupManager(userDataPath);
  await manager.createBackup({ db, trigger: SqliteBackupTrigger.Manual });
  db.prepare('UPDATE demo SET value = ? WHERE id = 1').run('after backup');
  db.close();
  const companionRoot = path.join(userDataPath, PI_COMPANION_SESSIONS_ROOT_DIR);
  const nativeSessions = [
    { root: userDataPath, id: 'cowork' },
    { root: companionRoot, id: 'companion' },
  ].map(({ root, id }) => {
    const filename = writePiSession(root, id);
    return { root, id, filename, original: fs.readFileSync(filename) };
  });

  (await openSqliteDatabaseWithRecovery(userDataPath, dbPath)).close();
  for (const session of nativeSessions) {
    await expect(resolvePiSessionStoreFile(session.root, session.id)).resolves.toMatchObject({
      sessionFile: session.filename,
    });
  }

  fs.writeFileSync(dbPath, 'not-a-sqlite-db', 'utf8');

  const restoredDb = await openSqliteDatabaseWithRecovery(userDataPath, dbPath);
  expect(restoredDb.prepare('SELECT value FROM demo WHERE id = 1').get()).toEqual({
    value: 'restored',
  });
  restoredDb.close();
  const quarantineRoot = manager.getPaths().quarantineDir;
  const entries = fs.readdirSync(quarantineRoot);
  expect(entries).toHaveLength(1);
  for (const session of nativeSessions) {
    await expect(resolvePiSessionStoreFile(session.root, session.id)).resolves.toMatchObject({
      sessionFile: null,
    });
    const archived = path.join(
      quarantineRoot,
      entries[0],
      path.relative(userDataPath, session.filename),
    );
    expect(fs.readFileSync(archived)).toEqual(session.original);
  }
});

test('failed native history quarantine rolls back earlier moves and keeps the database', async () => {
  const userDataPath = makeTempDir();
  const dbPath = path.join(userDataPath, DB_FILENAME);
  const manager = new SqliteBackupManager(userDataPath);
  const db = new Database(dbPath);
  db.exec('CREATE TABLE demo (value TEXT NOT NULL);');
  db.prepare('INSERT INTO demo (value) VALUES (?)').run('backup');
  await manager.createBackup({ db, trigger: SqliteBackupTrigger.Manual });
  db.prepare('UPDATE demo SET value = ?').run('current');
  db.close();
  const piSession = writePiSession(userDataPath, 'cowork');
  const companionRoot = path.join(userDataPath, PI_COMPANION_SESSIONS_ROOT_DIR);
  const companionSession = writePiSession(companionRoot, 'companion');
  const originalRename = fs.renameSync;
  const rename = vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
    if (source === companionRoot) {
      throw Object.assign(new Error('cannot archive session history'), { code: 'EACCES' });
    }
    originalRename(source, target);
  });

  try {
    await expect(manager.restoreLatestBackup(dbPath)).rejects.toThrow('cannot archive session');
    expect(fs.existsSync(piSession)).toBe(true);
    expect(fs.existsSync(companionSession)).toBe(true);
    const currentDb = new Database(dbPath, { readonly: true });
    expect(currentDb.prepare('SELECT value FROM demo').get()).toEqual({ value: 'current' });
    currentDb.close();
  } finally {
    rename.mockRestore();
  }
});

test('startup recovery without a snapshot still archives native history before a fresh database', async () => {
  const userDataPath = makeTempDir();
  const dbPath = path.join(userDataPath, DB_FILENAME);
  fs.writeFileSync(dbPath, 'not-a-sqlite-db', 'utf8');
  const piSession = writePiSession(userDataPath, 'cowork');

  await expect(openSqliteDatabaseWithRecovery(userDataPath)).rejects.toThrow();
  (await openSqliteDatabaseWithRecovery(userDataPath)).close();

  await expect(resolvePiSessionStoreFile(userDataPath, 'cowork')).resolves.toMatchObject({
    sessionFile: null,
  });
  const quarantineRoot = new SqliteBackupManager(userDataPath).getPaths().quarantineDir;
  const [entry] = fs.readdirSync(quarantineRoot);
  expect(
    fs.existsSync(path.join(quarantineRoot, entry, path.relative(userDataPath, piSession))),
  ).toBe(true);
});

test('restoreLatestBackup falls back to the previous backup file when publish was interrupted', async () => {
  const userDataPath = makeTempDir();
  const dbPath = path.join(userDataPath, 'demo.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  db.prepare('INSERT INTO demo (value) VALUES (?)').run('first');

  const manager = new SqliteBackupManager(userDataPath);
  const record = await manager.createBackup({ db, trigger: SqliteBackupTrigger.Manual });
  db.close();

  const backupPath = path.join(manager.getPaths().snapshotsDir, record.fileName);
  const previousBackupPath = `${backupPath}.previous`;
  fs.renameSync(backupPath, previousBackupPath);

  fs.writeFileSync(dbPath, 'not-a-sqlite-db', 'utf8');

  const result = await manager.restoreLatestBackup(dbPath);
  expect(result.restored).toBe(true);

  const restoredDb = new Database(dbPath, { readonly: true });
  expect(restoredDb.prepare('SELECT value FROM demo WHERE id = 1').get()).toEqual({
    value: 'first',
  });
  restoredDb.close();
});
