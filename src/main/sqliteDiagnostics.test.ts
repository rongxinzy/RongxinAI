import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import { formatEventLoopLag, readSqliteDiagnosticsSnapshot } from './sqliteDiagnostics';

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

test('formatEventLoopLag reports the gap with the CPU time it earned', () => {
  expect(formatEventLoopLag(1_500, 1_450)).toBe(
    'event-loop lag 1500ms (CPU time during the gap 1450ms, 96.7%)',
  );
  // A sleeping machine and a blocked synchronous wait look the same to the
  // timer, so the numbers are reported without claiming which one it was:
  // low CPU is evidence for the reader, not proof of a suspend.
  expect(formatEventLoopLag(33_607_636, 5_000)).toContain('0.0%');
  expect(formatEventLoopLag(411, 16)).toBe(
    'event-loop lag 411ms (CPU time during the gap 16ms, 3.9%)',
  );
});
