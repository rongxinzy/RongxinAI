import type { PreparedImage } from '@earendil-works/pi-durable/tools';
import { ArtifactWorkerLimit } from './artifactWorkerConstants';
import type { DurableImageInput } from './artifactWorkerTypes';

const mimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);

/** Metadata-only guards; image header parsing and decoding belong to the worker. */
export function assertDurableImageInput(input: DurableImageInput): void {
  if (
    !(input.bytes instanceof ArrayBuffer) ||
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > ArtifactWorkerLimit.ImageBytes
  )
    throw new Error('Durable image input limit exceeded.');
  if (!mimeTypes.has(input.mimeType)) throw new Error('Unsupported durable image format.');
  if (
    !input.limits ||
    !Number.isSafeInteger(input.limits.maxWidth) ||
    !Number.isSafeInteger(input.limits.maxHeight) ||
    !Number.isSafeInteger(input.limits.maxBytes) ||
    input.limits.maxWidth < 1 ||
    input.limits.maxWidth > ArtifactWorkerLimit.ImageDimension ||
    input.limits.maxHeight < 1 ||
    input.limits.maxHeight > ArtifactWorkerLimit.ImageDimension ||
    input.limits.maxBytes < 1 ||
    input.limits.maxBytes > ArtifactWorkerLimit.ImageOutputBytes
  )
    throw new Error('Invalid durable image output limits.');
}

export function isPreparedDurableImage(
  value: unknown,
  input: DurableImageInput,
): value is PreparedImage | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const image = value as Partial<PreparedImage>;
  if (
    typeof image.data !== 'string' ||
    image.data.length > input.limits.maxBytes ||
    typeof image.mimeType !== 'string' ||
    !mimeTypes.has(image.mimeType) ||
    image.mimeType === 'image/bmp' ||
    (image.convertedFrom !== undefined && !mimeTypes.has(image.convertedFrom))
  )
    return false;
  if (!image.resized) return true;
  const { from, to } = image.resized;
  return (
    [from, to].every(
      size =>
        size &&
        Number.isSafeInteger(size.width) &&
        Number.isSafeInteger(size.height) &&
        size.width > 0 &&
        size.height > 0 &&
        size.width <= ArtifactWorkerLimit.ImageDimension &&
        size.height <= ArtifactWorkerLimit.ImageDimension,
    ) &&
    from.width * from.height <= ArtifactWorkerLimit.ImagePixels &&
    to.width <= input.limits.maxWidth &&
    to.height <= input.limits.maxHeight
  );
}
