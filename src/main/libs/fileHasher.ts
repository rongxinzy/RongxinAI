import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

/** Defaults for the shared streaming SHA-256 worker. */
const FILE_HASHER_LIMITS = {
  MaxBytes: 512 * 1024 * 1024,
  TimeoutMs: 120_000,
  MaxPathLength: 4096,
} as const;

type HasherOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Upper bound accepted by the worker; callers with larger files raise it. */
  maxBytes?: number;
  /** Compiled worker path; tests inject the tsc output. */
  workerPath?: string;
};

/**
 * Stream a file through the shared SHA-256 worker (src/main/libs/hashWorker.ts).
 * Spawn-per-job like the app-update hasher: jobs are rare, so pool reuse
 * would only add lifecycle complexity. The main thread never reads the file.
 */
export async function sha256FileStream(
  filePath: string,
  options: HasherOptions = {},
): Promise<string> {
  const {
    signal,
    timeoutMs = FILE_HASHER_LIMITS.TimeoutMs,
    maxBytes = FILE_HASHER_LIMITS.MaxBytes,
    workerPath = path.join(__dirname, 'hashWorker.js'),
  } = options;
  signal?.throwIfAborted();
  if (typeof filePath !== 'string' || filePath.length > FILE_HASHER_LIMITS.MaxPathLength) {
    throw new Error('Invalid file path for hashing');
  }
  if (!path.isAbsolute(filePath)) {
    throw new Error('Hashing requires an absolute file path');
  }
  const stat: fs.Stats | null = await fs.promises.stat(filePath).catch((): null => null);
  if (!stat?.isFile() || stat.size <= 0 || stat.size > maxBytes) {
    throw new Error('File size is invalid for hashing');
  }
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(workerPath, { workerData: { file: filePath, maxBytes } });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Unable to start file hash worker'));
      return;
    }
    let settled = false;
    const finish = (error?: Error, digest?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error || !digest) reject(error ?? new Error('Invalid file hash result'));
      else resolve(digest);
    };
    const abort = () => finish(new Error('File hash cancelled'));
    const timer = setTimeout(() => finish(new Error('File hash timed out')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    worker.once('error', () => finish(new Error('File hash worker failed')));
    worker.once('exit', () => finish(new Error('File hash worker exited before a digest')));
    worker.once('message', (message: { digest?: string; error?: string; runMs?: number }) => {
      if (message.error || !/^[a-f0-9]{64}$/.test(message.digest ?? '')) {
        finish(new Error(message.error || 'Invalid file hash digest'));
      } else {
        console.debug(
          `[FileHasher] hashed ${path.basename(filePath)} (${stat.size} bytes) in ${Math.round(message.runMs ?? 0)} ms`,
        );
        finish(undefined, message.digest);
      }
    });
  });
}
