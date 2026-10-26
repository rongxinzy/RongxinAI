export const CompanionImageLimit = {
  Pixels: 32_000_000,
  Dimension: 16_384,
  Width: 2000,
  Height: 2000,
  EncodedBytes: 1024 * 1024,
  BatchEncodedBytes: 4 * 1024 * 1024,
} as const;

export const CompanionImageIssue = {
  Invalid: 'companion_image_invalid',
  TooLarge: 'companion_image_too_large',
  Unavailable: 'companion_image_unavailable',
  Unsupported: 'companion_image_unsupported',
} as const;
export const CompanionImageEntry = { User: 'zhiyuan.companion.image-input' } as const;

export const COMPANION_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
export function isCompanionImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(name.slice(name.lastIndexOf('.') + 1).toLowerCase());
}
export function isCompanionImageFile(file: { name: string; type: string }): boolean {
  return (
    isCompanionImageName(file.name) ||
    [...COMPANION_IMAGE_MIME_TYPES, 'image/bmp'].includes(file.type)
  );
}

export interface CompanionImageSource {
  id: string;
  name: string;
  path: string;
}

/** Internal model input. Never part of a renderer draft or history projection. */
export interface CompanionPreparedImage {
  id: string;
  name: string;
  data: string;
  mimeType: (typeof COMPANION_IMAGE_MIME_TYPES)[number];
}
