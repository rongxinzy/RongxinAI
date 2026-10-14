import fs from 'fs';
import type Database from 'better-sqlite3';

const DEFAULT_INTERVAL_MS = 1000;
const EVENT_LOOP_LAG_WARN_THRESHOLD_MS = 250;
const EVENT_LOOP_LAG_LOG_COOLDOWN_MS = 5000;
/** A timer gap this large cannot be explained by ordinary blocking alone. */
export const EVENT_LOOP_LAG_SUSPEND_THRESHOLD_MS = 120_000;
/** Share of the gap that must be CPU time for the process to count as busy. */
const SUSPECT_SUSPEND_CPU_SHARE = 0.2;

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

/**
 * Whether a long timer gap looks like a suspended machine rather than blocked work.
 *
 * Duration alone cannot tell the two apart: a two-minute freeze is exactly the
 * event-loop stall this diagnostic exists to catch, and hiding those behind a
 * "suspend" verdict would remove the signal. CPU time is the discriminator - a
 * process that was asleep earns almost none of the gap - and the finding stays a
 * warning either way, labelled with the measurement that produced it.
 */
export function isSuspectSuspend(lagMs: number, cpuMs: number): boolean {
  return lagMs >= EVENT_LOOP_LAG_SUSPEND_THRESHOLD_MS && cpuMs < lagMs * SUSPECT_SUSPEND_CPU_SHARE;
}

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
  let lastCpu = process.cpuUsage();
  const timer = setInterval(() => {
    const now = performance.now();
    const lagMs = now - expectedAt;
    expectedAt = now + intervalMs;
    const cpu = process.cpuUsage(lastCpu);
    lastCpu = process.cpuUsage();
    const cpuMs = (cpu.user + cpu.system) / 1000;
    if (lagMs < EVENT_LOOP_LAG_WARN_THRESHOLD_MS) return;
    if (now - lastLagLogAt < EVENT_LOOP_LAG_LOG_COOLDOWN_MS) return;
    lastLagLogAt = now;
    if (isSuspectSuspend(lagMs, cpuMs)) {
      // Still a warning: the gap is real and worth seeing. The label keeps it
      // from reading as a blocked main thread, and the snapshot is skipped
      // because database state cannot explain a sleeping machine.
      console.warn(
        `[SqliteDiagnostics] timer gap ${Math.round(lagMs)}ms with ${((cpuMs / lagMs) * 100).toFixed(1)}% CPU time - the process was not running (system suspend or clock jump), not a blocked event loop`,
      );
      return;
    }

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
