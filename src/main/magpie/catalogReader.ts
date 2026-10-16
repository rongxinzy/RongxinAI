import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { MagpieModel } from '../../shared/magpie/types';
let running = false;
/** One worker, no unbounded queue. Manager coalesces overlapping catalog reads. */
export async function parseMagpieCatalog(
  bytes: ArrayBuffer,
  signal: AbortSignal,
): Promise<MagpieModel[]> {
  signal.throwIfAborted();
  if (bytes.byteLength > 2_000_000) throw new Error('Model catalog exceeds size limit');
  if (running) throw new Error('Model catalog parsing is busy');
  running = true;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'catalogWorker.js'), {
        workerData: { bytes },
        transferList: [bytes],
      });
      let settled = false;
      const finish = (error?: Error, models?: MagpieModel[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        void worker.terminate();
        if (error) reject(error);
        else resolve(models!);
      };
      const abort = () => finish(new Error('Model catalog read cancelled'));
      const timer = setTimeout(() => finish(new Error('Model catalog parsing timed out')), 10_000);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      worker.once('error', () => finish(new Error('Model catalog worker failed')));
      worker.once('exit', () => finish(new Error('Model catalog worker exited')));
      worker.once('message', (result: { models?: MagpieModel[]; runMs?: number }) => {
        if (!Array.isArray(result.models)) return finish(new Error('Invalid model catalog'));
        console.debug(`[Magpie] catalog ran ${Math.round(result.runMs ?? 0)} ms (queue 0 ms)`);
        finish(undefined, result.models);
      });
    });
  } finally {
    running = false;
  }
}
export async function readBoundedCatalog(
  response: Response,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const length = Number(response.headers.get('content-length'));
  if (length > 2_000_000) {
    await response.body?.cancel();
    throw new Error('Model catalog exceeds size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty model catalog');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2_000_000) throw new Error('Model catalog exceeds size limit');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer.buffer;
}
