import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const MAX_UPDATE_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_PENDING_HASHES = 2;
const HASH_TIMEOUT_MS = 10 * 60 * 1000;

type HashResponse = { digest?: string; error?: string; runMs?: number };
type HashJob = {
  filePath: string;
  queuedAt: number;
  resolve: (digest: string) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort: () => void;
};

const queue: HashJob[] = [];
let active: { job: HashJob; worker: Worker; cancel: () => void } | null = null;

function dispatch(): void {
  if (active || queue.length === 0) return;
  const job = queue.shift()!;
  let worker: Worker;
  try {
    worker = new Worker(path.join(__dirname, 'appUpdateHashWorker.js'));
  } catch (error) {
    job.signal?.removeEventListener('abort', job.abort);
    job.reject(error instanceof Error ? error : new Error('Unable to start update hash worker'));
    queueMicrotask(dispatch);
    return;
  }
  const started = performance.now();
  let finished = false;
  const finish = (error?: Error, digest?: string, runMs?: number): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    job.signal?.removeEventListener('abort', job.abort);
    void worker.terminate();
    active = null;
    if (error || !digest) job.reject(error ?? new Error('Invalid update hash result'));
    else {
      console.debug(
        `[AppUpdate] hashed update after ${Math.round(started - job.queuedAt)} ms queued and ${Math.round(runMs ?? performance.now() - started)} ms running`,
      );
      job.resolve(digest);
    }
    dispatch();
  };
  const timer = setTimeout(() => finish(new Error('Update hash timed out')), HASH_TIMEOUT_MS);
  active = { job, worker, cancel: () => finish(new Error('Update hash cancelled')) };
  worker.once('message', (response: HashResponse) => {
    if (response.error) finish(new Error(response.error));
    else if (typeof response.digest === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(response.digest)) {
      finish(undefined, response.digest, response.runMs);
    } else finish(new Error('Invalid update hash result'));
  });
  worker.once('error', error => finish(error));
  worker.once('exit', code => {
    finish(new Error(`Update hash worker exited before returning a digest (code ${code})`));
  });
  try {
    worker.postMessage({ filePath: job.filePath });
  } catch (error) {
    finish(error instanceof Error ? error : new Error('Unable to start update hash'));
  }
}

export async function sha512UpdateFile(filePath: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('Update hash cancelled');
  if (typeof filePath !== 'string' || filePath.length > 4096 || !path.isAbsolute(filePath)) {
    throw new Error('Invalid update file path');
  }
  const stat = await fs.promises.stat(filePath);
  if (signal?.aborted) throw new Error('Update hash cancelled');
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_UPDATE_FILE_BYTES) {
    throw new Error('Update file size is invalid');
  }
  if (queue.length + Number(active !== null) >= MAX_PENDING_HASHES) {
    throw new Error('Update hash queue is full');
  }
  return new Promise((resolve, reject) => {
    const job: HashJob = {
      filePath,
      queuedAt: performance.now(),
      resolve,
      reject,
      signal,
      abort: () => {
        if (active?.job === job) {
          active.cancel();
        } else {
          const index = queue.indexOf(job);
          if (index >= 0) queue.splice(index, 1);
          signal?.removeEventListener('abort', job.abort);
          reject(new Error('Update hash cancelled'));
          dispatch();
        }
      },
    };
    queue.push(job);
    signal?.addEventListener('abort', job.abort, { once: true });
    if (signal?.aborted) job.abort();
    else dispatch();
  });
}
