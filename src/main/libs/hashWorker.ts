import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const started = performance.now();
let size = 0;
const { file, algorithm, maxBytes } = workerData as {
  file: string;
  algorithm: 'sha256' | 'sha512';
  maxBytes: number;
};
const hash = createHash(algorithm);
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
  parentPort?.postMessage({
    digest: hash.digest(algorithm === 'sha512' ? 'base64' : 'hex'),
    runMs: performance.now() - started,
  }),
);
