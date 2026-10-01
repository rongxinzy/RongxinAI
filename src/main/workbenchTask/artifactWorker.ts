import { ArtifactWorkerLimit } from './artifactWorkerConstants';
import { parentPort } from 'node:worker_threads';
import { collectWorkbenchArtifacts } from './artifactCollector';
import { runTextWorkerOperation, type TextWorkerInput } from './textWorkerOperations';

parentPort?.on(
  'message',
  (input: Parameters<typeof collectWorkbenchArtifacts>[0] | TextWorkerInput) => {
    const startedAt = performance.now();
    try {
      if ('kind' in input) {
        parentPort?.postMessage({
          text: runTextWorkerOperation(input),
          runMs: performance.now() - startedAt,
        });
        return;
      }
      if (Buffer.byteLength(JSON.stringify(input)) > ArtifactWorkerLimit.InputBytes) {
        throw new Error('Artifact collection input limit exceeded.');
      }
      const artifacts = collectWorkbenchArtifacts(input);
      parentPort?.postMessage({ artifacts, runMs: performance.now() - startedAt });
    } catch (error) {
      parentPort?.postMessage({
        error: error instanceof Error ? error.message : String(error),
        runMs: performance.now() - startedAt,
      });
    }
  },
);
