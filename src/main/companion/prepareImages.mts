import path from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fliph, flipv, PhotonImage, resize, SamplingFilter } from '@silvia-odwyer/photon-node';
import { imageSize } from 'image-size';
import {
  COMPANION_MAX_ATTACHMENTS,
  COMPANION_MAX_ATTACHMENT_BYTES,
} from '../../shared/companion/attachments.js';
import {
  CompanionImageIssue,
  CompanionImageLimit,
  type CompanionImageSource,
  type CompanionPreparedImage,
} from '../../shared/companion/images.js';

type ImageMimeType = CompanionPreparedImage['mimeType'] | 'image/bmp';

const mimeTypes: Record<string, ImageMimeType | undefined> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

const jpegQualities = [80, 70, 55, 40];

// image-size reads JPEG orientation only. WebP can carry it in a separate RIFF chunk.
function webpOrientation(bytes: Buffer): number {
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) break;
    if (bytes.toString('ascii', offset, offset + 4) === 'EXIF') {
      const tiff = bytes.toString('ascii', start, start + 6) === 'Exif\0\0' ? start + 6 : start;
      if (tiff + 8 > end) break;
      const littleEndian = bytes.toString('ascii', tiff, tiff + 2) === 'II';
      const view = new DataView(bytes.buffer, bytes.byteOffset + tiff, end - tiff);
      if (view.getUint16(2, littleEndian) !== 42) break;
      const directory = view.getUint32(4, littleEndian);
      if (directory + 2 > view.byteLength) break;
      const count = view.getUint16(directory, littleEndian);
      for (let index = 0; index < count; index++) {
        const entry = directory + 2 + index * 12;
        if (entry + 12 > view.byteLength) break;
        if (view.getUint16(entry, littleEndian) === 0x0112) {
          return view.getUint16(entry + 8, littleEndian);
        }
      }
      break;
    }
    offset = end + (size % 2);
  }
  return 1;
}

function orientImage(image: PhotonImage, orientation: number): PhotonImage {
  if (orientation <= 4) {
    if (orientation === 2 || orientation === 3) fliph(image);
    if (orientation === 3 || orientation === 4) flipv(image);
    return image;
  }

  const width = image.get_width();
  const height = image.get_height();
  const source = image.get_raw_pixels();
  const pixels = new Uint8Array(source.length);
  for (let y = 0; y < height; y++) {
    const targetX = orientation === 5 || orientation === 8 ? y : height - y - 1;
    for (let x = 0; x < width; x++) {
      const targetY = orientation === 5 || orientation === 6 ? x : width - x - 1;
      const from = (y * width + x) * 4;
      pixels.set(source.subarray(from, from + 4), (targetY * height + targetX) * 4);
    }
  }
  return new PhotonImage(pixels, height, width);
}

function encodeWithinLimit(bytes: Uint8Array): string | undefined {
  if (4 * Math.ceil(bytes.byteLength / 3) > CompanionImageLimit.EncodedBytes) return;
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function prepareImage(bytes: Buffer, mimeType: ImageMimeType, orientation: number) {
  let image: PhotonImage | undefined;
  try {
    // Decode before retaining the original bytes to reject damaged images.
    image = PhotonImage.new_from_byteslice(bytes);
    if (orientation !== 1) {
      const upright = orientImage(image, orientation);
      if (upright !== image) image.free();
      image = upright;
    }
    const width = image.get_width();
    const height = image.get_height();
    if (
      orientation === 1 &&
      mimeType !== 'image/bmp' &&
      width <= CompanionImageLimit.Width &&
      height <= CompanionImageLimit.Height
    ) {
      const data = encodeWithinLimit(bytes);
      if (data) return { data, mimeType };
    }

    const scale = Math.min(
      1,
      CompanionImageLimit.Width / width,
      CompanionImageLimit.Height / height,
    );
    let targetWidth = Math.max(1, Math.round(width * scale));
    let targetHeight = Math.max(1, Math.round(height * scale));
    for (;;) {
      const scaled: PhotonImage =
        targetWidth === width && targetHeight === height
          ? image
          : resize(image, targetWidth, targetHeight, SamplingFilter.Lanczos3);
      try {
        if (mimeType !== 'image/jpeg') {
          const data = encodeWithinLimit(scaled.get_bytes());
          if (data) return { data, mimeType: 'image/png' as const };
        }
        for (const quality of jpegQualities) {
          const data = encodeWithinLimit(scaled.get_bytes_jpeg(quality));
          if (data) return { data, mimeType: 'image/jpeg' as const };
        }
        if (mimeType === 'image/jpeg') {
          const data = encodeWithinLimit(scaled.get_bytes());
          if (data) return { data, mimeType: 'image/png' as const };
        }
      } finally {
        if (scaled !== image) scaled.free();
      }
      if (targetWidth === 1 && targetHeight === 1) return;
      targetWidth = Math.max(1, Math.floor(targetWidth * 0.75));
      targetHeight = Math.max(1, Math.floor(targetHeight * 0.75));
    }
  } catch (cause) {
    throw new Error(CompanionImageIssue.Invalid, { cause });
  } finally {
    image?.free();
  }
}

/** Worker-only: no fallback onto Electron's main thread or unbounded nested workers. */
export async function prepareCompanionImages(
  sources: readonly CompanionImageSource[],
): Promise<CompanionPreparedImage[]> {
  if (!sources.length || sources.length > COMPANION_MAX_ATTACHMENTS)
    throw new Error(CompanionImageIssue.Invalid);
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
      const orientation =
        mimeType === 'image/webp' ? webpOrientation(bytes) : (size.orientation ?? 1);
      const prepared = prepareImage(
        bytes,
        mimeType,
        orientation >= 1 && orientation <= 8 ? orientation : 1,
      );
      if (!prepared) throw new Error(CompanionImageIssue.Invalid);
      encodedBytes += prepared.data.length;
      if (encodedBytes > CompanionImageLimit.BatchEncodedBytes)
        throw new Error(CompanionImageIssue.TooLarge);
      images.push({
        id: source.id,
        name: source.name,
        ...prepared,
      });
    } finally {
      await file.close();
    }
  }
  return images;
}
