import type { DraftAttachment } from '../../../store/slices/coworkSlice';

// Stable empty array reference to avoid unnecessary re-renders from useSelector
// returning a new [] on every call (when draftAttachments[draftKey] is undefined).
export const EMPTY_ATTACHMENTS: DraftAttachment[] = [];
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.tiff',
  '.tif',
  '.ico',
  '.avif',
]);

export const isImagePath = (filePath: string): boolean => {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = filePath.slice(dotIndex).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
};

export const isImageMimeType = (mimeType: string): boolean => {
  return mimeType.startsWith('image/');
};

export const extractBase64FromDataUrl = (
  dataUrl: string,
): { mimeType: string; base64Data: string } | null => {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64Data: match[2] };
};

export const getFileNameFromPath = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};
