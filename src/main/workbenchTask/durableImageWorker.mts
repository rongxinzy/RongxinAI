import { readFile } from 'node:fs/promises';
import { isMainThread } from 'node:worker_threads';
import { imageSize } from 'image-size';
import { createPhotonImages } from '@earendil-works/pi-durable/images';
import type { PreparedImage } from '@earendil-works/pi-durable/tools';
import { ArtifactWorkerLimit } from './artifactWorkerConstants.js';
import { assertDurableImageInput } from './durableImagePolicy.js';
import type { DurableImageInput } from './artifactWorkerTypes.js';

const mimeTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** Uses only our packaged WASM, never an upstream nested worker or main-thread fallback. */
export async function prepareDurableImageInWorker(
  input: DurableImageInput,
  wasmPath: string,
): Promise<PreparedImage | undefined> {
  if (isMainThread) throw new Error('Durable image decoding requires an artifact worker.');
  assertDurableImageInput(input);
  const bytes = new Uint8Array(input.bytes);
  let size: ReturnType<typeof imageSize>;
  try {
    size = imageSize(bytes);
  } catch {
    return undefined;
  }
  const { width, height, type } = size;
  if (!type || mimeTypes[type] !== input.mimeType) return undefined;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    return undefined;
  if (
    width > ArtifactWorkerLimit.ImageDimension ||
    height > ArtifactWorkerLimit.ImageDimension ||
    width * height > ArtifactWorkerLimit.ImagePixels
  )
    throw new Error('Durable image pixel limit exceeded.');
  const processor = createPhotonImages(await readFile(wasmPath));
  return processor.prepare(bytes, input.mimeType, input.limits);
}
