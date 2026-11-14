import type { ImageProcessor } from '@earendil-works/pi-durable/tools';
import { prepareDurableImageAsync } from '../../workbenchTask/artifactWorkerPool';

/** Resolves cancellation per invocation, so a reused session never retains an old signal. */
export function createDurableImageProcessor(
  getSignal?: () => AbortSignal | undefined,
): ImageProcessor {
  return {
    prepare: (bytes, mimeType, limits) =>
      prepareDurableImageAsync(bytes, mimeType, limits, getSignal?.()),
  };
}
