import path from 'node:path';
import { Worker } from 'node:worker_threads';

export type SqliteVerifyMode = 'quick_check' | 'integrity_check';

/** Bounds for off-thread sqlite verification (AGENTS.md worker requirements). */
const SQLITE_VERIFY_LIMITS = {
  TimeoutMs: 120_000,
  MaxPathLength: 4096,
} as const;

export interface SqliteVerifyResult {
  check: string;
  userVersion: number;
  schemaVersion: number;
}

type VerifyResponse = {
  check?: string;
  userVersion?: number;
  schemaVersion?: number;
  error?: string;
  runMs: number;
};

export interface SqliteVerifyOptions {
  signal?: AbortSignal;
  /** Compiled worker path; tests inject the tsc output. */
  workerPath?: string;
}

/**
 * Run quick_check/integrity_check plus header pragmas on a database file in a
 * worker's readonly connection, keeping page-walk work off the main thread.
 * The main process validates the path and the structured result.
 */
export async function verifySqliteFile(
  filePath: string,
  mode: SqliteVerifyMode,
  options: SqliteVerifyOptions = {},
): Promise<SqliteVerifyResult> {
  const { signal, workerPath = path.join(__dirname, 'sqliteVerifyWorker.js') } = options;
  signal?.throwIfAborted();
  if (
    typeof filePath !== 'string' ||
    filePath.length > SQLITE_VERIFY_LIMITS.MaxPathLength ||
    !path.isAbsolute(filePath)
  ) {
    throw new Error('Sqlite verification requires an absolute file path');
  }
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(workerPath);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Unable to start sqlite verify worker'));
      return;
    }
    let settled = false;
    const finish = (error?: Error, result?: SqliteVerifyResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error || !result) reject(error ?? new Error('Invalid sqlite verify result'));
      else resolve(result);
    };
    const abort = () => finish(new Error('Sqlite verification cancelled'));
    const timer = setTimeout(
      () => finish(new Error('Sqlite verification timed out')),
      SQLITE_VERIFY_LIMITS.TimeoutMs,
    );
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    worker.once('error', () => finish(new Error('Sqlite verify worker failed')));
    worker.once('exit', () => finish(new Error('Sqlite verify worker exited before a result')));
    worker.once('message', (response: VerifyResponse) => {
      if (
        response.error ||
        typeof response.check !== 'string' ||
        !Number.isInteger(response.userVersion) ||
        (response.userVersion ?? -1) < 0 ||
        !Number.isInteger(response.schemaVersion) ||
        (response.schemaVersion ?? -1) < 0
      ) {
        finish(new Error(response.error || 'Invalid sqlite verify worker result'));
      } else {
        console.debug(
          `[SqliteBackup] ${mode} finished in ${Math.round(response.runMs)} ms in worker`,
        );
        finish(undefined, {
          check: response.check,
          userVersion: response.userVersion!,
          schemaVersion: response.schemaVersion!,
        });
      }
    });
    try {
      worker.postMessage({ filePath, mode });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
