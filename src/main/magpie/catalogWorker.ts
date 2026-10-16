import { parentPort, workerData } from 'node:worker_threads';
import { projectMagpieCatalog } from './catalog';
const started = performance.now();
try {
  const bytes = workerData.bytes as ArrayBuffer;
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 2_000_000)
    throw new Error('Invalid catalog input');
  const models = projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes)));
  parentPort?.postMessage({ models, runMs: performance.now() - started });
} catch {
  parentPort?.postMessage({ error: 'Invalid model catalog' });
}
