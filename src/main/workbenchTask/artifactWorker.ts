import { runTextWorkerOperation } from './textWorkerOperations';
import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { collectWorkbenchArtifacts } from './artifactCollector';
import { ArtifactWorkerLimit, ArtifactWorkerTask } from './artifactWorkerConstants';
import type { ArtifactWorkerInput } from './artifactWorkerTypes';

parentPort?.on('message', (job: ArtifactWorkerInput) => {
  const startedAt = performance.now();
  try {
    if (job.kind === ArtifactWorkerTask.TransformText) {
      parentPort?.postMessage({
        text: runTextWorkerOperation(job.input),
        runMs: performance.now() - startedAt,
      });
    } else if (job.kind === ArtifactWorkerTask.InspectWorkspaceContent) {
      if (
        !(job.input.bytes instanceof ArrayBuffer) ||
        job.input.bytes.byteLength > ArtifactWorkerLimit.WorkspaceContentBytes
      ) {
        throw new Error('Workspace content input limit exceeded.');
      }
      const bytes = Buffer.from(job.input.bytes);
      parentPort?.postMessage({
        content: {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          text: bytes.toString('utf8'),
          binary: bytes.includes(0),
        },
        runMs: performance.now() - startedAt,
      });
    } else {
      if (Buffer.byteLength(JSON.stringify(job.input)) > ArtifactWorkerLimit.InputBytes)
        throw new Error('Artifact collection input limit exceeded.');
      const artifacts = collectWorkbenchArtifacts(job.input);
      parentPort?.postMessage({ artifacts, runMs: performance.now() - startedAt });
    }
  } catch (error) {
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : String(error),
      runMs: performance.now() - startedAt,
    });
  }
});
