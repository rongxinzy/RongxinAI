import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
const started = performance.now();
const hash = createHash('sha256');
let size = 0;
const stream = createReadStream(workerData.file);
stream.on('data', chunk => {
  size += chunk.length;
  if (size > 512 * 1024 * 1024) stream.destroy(new Error('Binary exceeds size limit'));
  else hash.update(chunk);
});
stream.on('error', () => parentPort?.postMessage({ error: 'Unable to hash Magpie binary' }));
stream.on('end', () =>
  parentPort?.postMessage({ digest: hash.digest('hex'), runMs: performance.now() - started }),
);
