import { parentPort } from 'node:worker_threads';
import { prepareRequestBody } from './requestBody';

parentPort?.on(
  'message',
  ({ id, body, maxTokens }: { id: number; body: string; maxTokens?: number }) => {
    try {
      parentPort?.postMessage({ id, result: prepareRequestBody(body, maxTokens) });
    } catch {
      parentPort?.postMessage({ id, error: true });
    }
  },
);
