import path from 'node:path';
import { open, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { imageSize } from 'image-size';
import { createPhotonImages } from '@earendil-works/pi-durable/images';
import {
  COMPANION_MAX_ATTACHMENTS,
  COMPANION_MAX_ATTACHMENT_BYTES,
} from '../../shared/companion/attachments.js';
import {
  CompanionImageIssue,
  CompanionImageLimit,
  COMPANION_IMAGE_MIME_TYPES,
  type CompanionImageSource,
  type CompanionPreparedImage,
} from '../../shared/companion/images.js';

const mimeTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** Worker-only: no fallback onto Electron's main thread or unbounded nested workers. */
export async function prepareCompanionImages(
  sources: readonly CompanionImageSource[],
  wasmPath: string,
): Promise<CompanionPreparedImage[]> {
  if (!sources.length || sources.length > COMPANION_MAX_ATTACHMENTS)
    throw new Error(CompanionImageIssue.Invalid);
  const processor = createPhotonImages(await readFile(wasmPath));
  const images: CompanionPreparedImage[] = [];
  let encodedBytes = 0;
  for (const source of sources) {
    if (!path.isAbsolute(source.path) || (await realpath(source.path)) !== source.path)
      throw new Error(CompanionImageIssue.Unavailable);
    const file = await open(source.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size <= 0 || info.size > COMPANION_MAX_ATTACHMENT_BYTES)
        throw new Error(CompanionImageIssue.TooLarge);
      // A bounded positional read avoids a growing file bypassing the stat limit.
      const bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const read = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) throw new Error(CompanionImageIssue.Unavailable);
        offset += read.bytesRead;
      }
      if ((await file.stat()).size !== info.size) throw new Error(CompanionImageIssue.Unavailable);
      let size: ReturnType<typeof imageSize>;
      try {
        size = imageSize(bytes);
      } catch (cause) {
        throw new Error(CompanionImageIssue.Unsupported, { cause });
      }
      const { width, height, type } = size;
      const mimeType = type ? mimeTypes[type] : undefined;
      if (!mimeType) throw new Error(CompanionImageIssue.Unsupported);
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
        throw new Error(CompanionImageIssue.Invalid);
      if (
        width > CompanionImageLimit.Dimension ||
        height > CompanionImageLimit.Dimension ||
        width * height > CompanionImageLimit.Pixels
      )
        throw new Error(CompanionImageIssue.TooLarge);
      const prepared = await processor.prepare(bytes, mimeType, {
        maxWidth: CompanionImageLimit.Width,
        maxHeight: CompanionImageLimit.Height,
        maxBytes: CompanionImageLimit.EncodedBytes,
      });
      if (
        !prepared ||
        !COMPANION_IMAGE_MIME_TYPES.includes(
          prepared.mimeType as CompanionPreparedImage['mimeType'],
        )
      )
        throw new Error(CompanionImageIssue.Invalid);
      encodedBytes += prepared.data.length;
      if (encodedBytes > CompanionImageLimit.BatchEncodedBytes)
        throw new Error(CompanionImageIssue.TooLarge);
      images.push({
        id: source.id,
        name: source.name,
        data: prepared.data,
        mimeType: prepared.mimeType as CompanionPreparedImage['mimeType'],
      });
    } finally {
      await file.close();
    }
  }
  return images;
}
