import fs from 'fs';
import type Database from 'better-sqlite3';

const DEFAULT_INTERVAL_MS = 1000;
const EVENT_LOOP_LAG_WARN_THRESHOLD_MS = 250;
const EVENT_LOOP_LAG_LOG_COOLDOWN_MS = 5000;

export type SqliteDiagnosticsSnapshot = {
  databaseBytes: number;
  walBytes: number;
  shmBytes: number;
  coworkMessages: number;
  coworkSessions: number;
  journalMode: string;
  synchronous: number;
  pageCount: number;
  freelistPages: number;
};

type SqliteDiagnosticsOptions = {
  db: Database.Database;
  dbPath: string;
  intervalMs?: number;
};

const fileSize = (filePath: string): number => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
};

const pragmaNumber = (db: Database.Database, name: string): number => {
  const value = db.pragma(name, { simple: true });
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

export const readSqliteDiagnosticsSnapshot = (
  db: Database.Database,
  dbPath: string,
): SqliteDiagnosticsSnapshot => {
  const counts = db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM cowork_messages) AS cowork_messages,
          (SELECT COUNT(*) FROM cowork_sessions) AS cowork_sessions
      `,
    )
    .get() as { cowork_messages: number; cowork_sessions: number };

  return {
    databaseBytes: fileSize(dbPath),
    walBytes: fileSize(`${dbPath}-wal`),
    shmBytes: fileSize(`${dbPath}-shm`),
    coworkMessages: counts.cowork_messages,
    coworkSessions: counts.cowork_sessions,
    journalMode: String(db.pragma('journal_mode', { simple: true })),
    synchronous: pragmaNumber(db, 'synchronous'),
    pageCount: pragmaNumber(db, 'page_count'),
    freelistPages: pragmaNumber(db, 'freelist_count'),
  };
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const logSnapshot = (
  label: string,
  snapshot: SqliteDiagnosticsSnapshot,
  lagMs?: number,
  queryMs?: number,
): void => {
  const lag = lagMs === undefined ? '' : `, event-loop lag ${Math.round(lagMs)}ms`;
  const query = queryMs === undefined ? '' : `, diagnostics query ${Math.round(queryMs)}ms`;
  const message = `[SqliteDiagnostics] ${label}: database ${formatBytes(snapshot.databaseBytes)}, WAL ${formatBytes(snapshot.walBytes)}, SHM ${formatBytes(snapshot.shmBytes)}, ${snapshot.coworkMessages} messages across ${snapshot.coworkSessions} sessions, journal ${snapshot.journalMode}, synchronous=${snapshot.synchronous}, ${snapshot.pageCount} pages (${snapshot.freelistPages} free)${lag}${query}`;
  if (lagMs === undefined) {
    console.log(message);
  } else {
    console.warn(message);
  }
};

export const startSqliteDiagnostics = ({
  db,
  dbPath,
  intervalMs = DEFAULT_INTERVAL_MS,
}: SqliteDiagnosticsOptions): (() => void) => {
  try {
    logSnapshot('startup', readSqliteDiagnosticsSnapshot(db, dbPath));
  } catch (error) {
    console.warn('[SqliteDiagnostics] Startup snapshot failed:', error);
  }

  let expectedAt = performance.now() + intervalMs;
  let lastLagLogAt = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    const lagMs = now - expectedAt;
    expectedAt = now + intervalMs;
    if (lagMs < EVENT_LOOP_LAG_WARN_THRESHOLD_MS) return;
    if (now - lastLagLogAt < EVENT_LOOP_LAG_LOG_COOLDOWN_MS) return;
    lastLagLogAt = now;

    const queryStartedAt = performance.now();
    try {
      const snapshot = readSqliteDiagnosticsSnapshot(db, dbPath);
      logSnapshot('event-loop stall', snapshot, lagMs, performance.now() - queryStartedAt);
    } catch (error) {
      console.warn('[SqliteDiagnostics] Stall snapshot failed:', error);
    }
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
};
