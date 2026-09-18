import { parentPort } from 'node:worker_threads';
import { collectWorkbenchArtifacts } from './artifactCollector';

parentPort?.on('message', (input: Parameters<typeof collectWorkbenchArtifacts>[0]) => {
  const startedAt = performance.now();
  try {
    const artifacts = collectWorkbenchArtifacts(input);
    parentPort?.postMessage({ artifacts, runMs: performance.now() - startedAt });
  } catch (error) {
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : String(error),
      runMs: performance.now() - startedAt,
    });
  }
});
