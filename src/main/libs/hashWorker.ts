import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

// Shared streaming SHA-256 worker (moved from magpie/hashWorker so the
// sqlite backup manager can reuse it instead of growing a third hasher).
const started = performance.now();
const hash = createHash('sha256');
let size = 0;
const { file, maxBytes = 512 * 1024 * 1024 } = workerData as {
  file: string;
  maxBytes?: number;
};
const stream = createReadStream(file);
stream.on('data', chunk => {
  size += chunk.length;
  if (size > maxBytes) stream.destroy(new Error('File exceeds size limit'));
  else hash.update(chunk);
});
stream.on('error', error => {
  const message =
    (error as Error & { code?: string }).code === 'ENOENT'
      ? 'Unable to hash file: not found'
      : 'Unable to hash file';
  parentPort?.postMessage({ error: message });
});
stream.on('end', () =>
  parentPort?.postMessage({ digest: hash.digest('hex'), runMs: performance.now() - started }),
);
