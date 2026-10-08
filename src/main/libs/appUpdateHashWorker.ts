import crypto from 'node:crypto';
import fs from 'node:fs';
import { parentPort } from 'node:worker_threads';

type HashRequest = { filePath: string };
type HashResponse = { digest?: string; error?: string; runMs: number };

parentPort?.on('message', async (request: HashRequest) => {
  const started = performance.now();
  const response: HashResponse = { runMs: 0 };
  try {
    const hash = crypto.createHash('sha512');
    for await (const chunk of fs.createReadStream(request.filePath)) hash.update(chunk);
    response.digest = hash.digest('base64');
  } catch (error) {
    response.error = error instanceof Error ? error.message : 'Unable to hash update file';
  }
  response.runMs = performance.now() - started;
  parentPort?.postMessage(response);
});
