import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import { readSqliteDiagnosticsSnapshot } from './sqliteDiagnostics';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('readSqliteDiagnosticsSnapshot reports database files and cowork row counts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-sqlite-diagnostics-'));
  temporaryDirectories.push(directory);
  const dbPath = path.join(directory, 'zhiyuan.sqlite');
  const db = new Database(dbPath);

  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE cowork_sessions (id TEXT PRIMARY KEY);
      CREATE TABLE cowork_messages (id TEXT PRIMARY KEY, session_id TEXT);
      INSERT INTO cowork_sessions (id) VALUES ('session-1');
      INSERT INTO cowork_messages (id, session_id) VALUES ('message-1', 'session-1');
    `);

    const snapshot = readSqliteDiagnosticsSnapshot(db, dbPath);

    expect(snapshot.databaseBytes).toBeGreaterThan(0);
    expect(snapshot.coworkSessions).toBe(1);
    expect(snapshot.coworkMessages).toBe(1);
    expect(snapshot.journalMode.toLowerCase()).toBe('wal');
    expect(snapshot.pageCount).toBeGreaterThan(0);
  } finally {
    db.close();
  }
});
