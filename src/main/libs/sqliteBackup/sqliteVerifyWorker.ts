import Database from 'better-sqlite3';
import { parentPort } from 'node:worker_threads';

import type { SqliteVerifyMode } from './sqliteVerify';

/** Whitespace-tolerant string from a single-row PRAGMA read. */
function readPragmaText(db: Database.Database, pragma: string): string {
  const row = db.prepare(`PRAGMA ${pragma}`).pluck().get() as string | number | undefined;
  return typeof row === 'string' || typeof row === 'number' ? String(row) : '';
}

type VerifyRequest = { filePath: string; mode: SqliteVerifyMode };
type VerifyResponse = {
  check?: string;
  userVersion?: number;
  schemaVersion?: number;
  error?: string;
  runMs: number;
};

parentPort?.on('message', (request: VerifyRequest) => {
  const started = performance.now();
  const response: VerifyResponse = { runMs: 0 };
  let db: Database.Database | null = null;
  try {
    // Readonly connection on the worker's own thread: the check reads every
    // page, which must not block the main-process event loop.
    db = new Database(request.filePath, { readonly: true });
    response.check = readPragmaText(db, request.mode);
    response.userVersion = Number(readPragmaText(db, 'user_version')) || 0;
    response.schemaVersion = Number(readPragmaText(db, 'schema_version')) || 0;
  } catch (error) {
    response.error =
      error instanceof Error ? error.message : 'Sqlite verification failed in worker';
  } finally {
    try {
      db?.close();
    } catch {
      // Close failures surface through the check result, not a worker crash.
    }
  }
  response.runMs = performance.now() - started;
  parentPort?.postMessage(response);
});
