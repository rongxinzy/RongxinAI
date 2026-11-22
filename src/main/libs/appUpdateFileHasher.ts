import { hashFileStream } from './fileHasher';

const MAX_UPDATE_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_PENDING_HASHES = 2;
const HASH_TIMEOUT_MS = 10 * 60 * 1000;

const queue: Array<() => void> = [];
let active = false;

function dispatch(): void {
  if (active) return;
  const run = queue.shift();
  if (!run) return;
  active = true;
  run();
}

export async function sha512UpdateFile(filePath: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('Update hash cancelled');
  if (queue.length + Number(active) >= MAX_PENDING_HASHES) {
    throw new Error('Update hash queue is full');
  }
  return new Promise((resolve, reject) => {
    const run = (): void => {
      signal?.removeEventListener('abort', abort);
      void hashFileStream(filePath, 'sha512', {
        maxBytes: MAX_UPDATE_FILE_BYTES,
        timeoutMs: HASH_TIMEOUT_MS,
        signal,
      })
        .finally(() => {
          active = false;
          dispatch();
        })
        .then(resolve, reject);
    };
    const abort = () => {
      const index = queue.indexOf(run);
      if (index >= 0) queue.splice(index, 1);
      reject(new Error('Update hash cancelled'));
    };
    queue.push(run);
    signal?.addEventListener('abort', abort, { once: true });
    dispatch();
  });
}
