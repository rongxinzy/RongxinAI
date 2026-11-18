import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { DOCUMENT_MAX_CHARACTERS } from './constants';

interface OfficeDocument {
  format: string | null;
  text: string;
  markdownCharacters: number;
}

export function readOfficeDocument(
  filePath: string,
  signal: AbortSignal,
  workerPath = path.join(__dirname, 'documentWorker.js'),
): Promise<OfficeDocument> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: filePath });
    let finished = false;
    const finish = async (error?: Error, result?: OfficeDocument) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      await worker.terminate().catch((): undefined => undefined);
      if (result) resolve(result);
      else reject(error);
    };
    const abort = (): void => void finish(new Error('Document conversion cancelled or timed out.'));
    worker.once('message', (result: Partial<OfficeDocument> & { error?: string }) => {
      if (
        result &&
        (result.format === null ||
          (typeof result.format === 'string' && result.format.length <= 64)) &&
        typeof result.text === 'string' &&
        result.text.length <= DOCUMENT_MAX_CHARACTERS &&
        typeof result.markdownCharacters === 'number' &&
        Number.isSafeInteger(result.markdownCharacters) &&
        result.markdownCharacters >= result.text.length
      ) {
        void finish(undefined, {
          format: result.format,
          text: result.text,
          markdownCharacters: result.markdownCharacters,
        });
      } else {
        void finish(new Error(result?.error || 'Invalid document worker response.'));
      }
    });
    worker.once('error', error => void finish(error));
    worker.once(
      'exit',
      code => void finish(new Error(`Document worker exited before returning a result (${code}).`)),
    );
    signal.addEventListener('abort', abort, { once: true });
  });
}
