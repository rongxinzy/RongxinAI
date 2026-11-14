import { runTextWorkerOperation } from './textWorkerOperations';
import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { ArtifactWorkerLimit, ArtifactWorkerTask } from './artifactWorkerConstants';
import type { ArtifactWorkerInput } from './artifactWorkerTypes';
import path from 'node:path';
import { prepareCompanionImages } from '../companion/prepareImages.mjs';
import { prepareDurableImageInWorker } from './durableImageWorker.mjs';

parentPort?.on('message', async (job: ArtifactWorkerInput) => {
  const startedAt = performance.now();
  try {
    if (job.kind === ArtifactWorkerTask.PrepareDurableImage) {
      const image = await prepareDurableImageInWorker(
        job.input,
        path.join(__dirname, 'companion-photon.wasm'),
      );
      parentPort?.postMessage({ image, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.PrepareCompanionImages) {
      const images = await prepareCompanionImages(
        job.input.sources,
        path.join(__dirname, 'companion-photon.wasm'),
      );
      parentPort?.postMessage({ images, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.TransformText) {
      parentPort?.postMessage({
        text: runTextWorkerOperation(job.input),
        runMs: performance.now() - startedAt,
      });
    } else {
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
    }
  } catch (error) {
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : String(error),
      runMs: performance.now() - startedAt,
    });
  }
});
