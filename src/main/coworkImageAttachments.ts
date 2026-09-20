import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

export interface PersistedCoworkImageAttachment {
  name: string;
  mimeType: string;
  path: string;
}

export const coworkImageRoot = (userDataDir: string): string =>
  path.join(userDataDir, 'cowork-images');

const sanitizeSessionId = (sessionId: string): string => {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return safe || 'session';
};

const sanitizeFileName = (value: string): string => {
  const base = path.basename(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').trim();
  return base || 'image';
};

const extensionFor = (fileName: string, mimeType: string): string => {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName && fromName.length <= 8) return fromName;
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  return MIME_EXTENSION_MAP[normalized] ?? '.img';
};

const decodeBase64Payload = (value: string): Buffer => {
  const comma = value.indexOf(',');
  const payload = value.startsWith('data:') && comma >= 0 ? value.slice(comma + 1) : value;
  return Buffer.from(payload, 'base64');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function persistCoworkImageAttachments(
  rootDir: string,
  sessionId: string,
  attachments: unknown,
): PersistedCoworkImageAttachment[] {
  // Ownership: call this once at the store/IPC write boundary. Callers that only
  // forward already-persisted `{ path }` attachments are expected to no-op here.
  if (!Array.isArray(attachments)) return [];
  const dir = path.join(rootDir, sanitizeSessionId(sessionId));
  const stored: PersistedCoworkImageAttachment[] = [];

  for (const item of attachments) {
    if (!isRecord(item)) continue;
    const name = sanitizeFileName(typeof item.name === 'string' ? item.name : 'image');
    const mimeType =
      typeof item.mimeType === 'string' && item.mimeType.trim()
        ? item.mimeType.trim()
        : 'application/octet-stream';
    const existingPath = typeof item.path === 'string' ? item.path.trim() : '';
    const base64Data = typeof item.base64Data === 'string' ? item.base64Data : '';

    if (existingPath && (!base64Data || fs.existsSync(existingPath))) {
      stored.push({ name, mimeType, path: existingPath });
      continue;
    }
    if (!base64Data) continue;

    let bytes: Buffer;
    try {
      bytes = decodeBase64Payload(base64Data);
    } catch (error) {
      console.error('[CoworkImages] failed to decode image attachment:', error);
      continue;
    }
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      console.warn('[CoworkImages] skipped image outside the allowed size:', name, bytes.length);
      continue;
    }

    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32);
    const filePath = path.join(dir, `${hash}${extensionFor(name, mimeType)}`);
    try {
      if (!fs.existsSync(filePath)) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, bytes);
      }
    } catch (error) {
      console.error('[CoworkImages] failed to persist image attachment:', error);
      continue;
    }
    stored.push({ name, mimeType, path: filePath });
  }

  return stored;
}

export function persistMessageImageMetadata(
  rootDir: string,
  sessionId: string,
  metadata: Record<string, unknown> | undefined,
): { metadata: Record<string, unknown> | undefined; changed: boolean } {
  if (!metadata || !Array.isArray(metadata.imageAttachments)) {
    return { metadata, changed: false };
  }
  const hasInline = metadata.imageAttachments.some(
    item => isRecord(item) && typeof item.base64Data === 'string' && item.base64Data.length > 0,
  );
  if (!hasInline) return { metadata, changed: false };
  return {
    metadata: {
      ...metadata,
      imageAttachments: persistCoworkImageAttachments(
        rootDir,
        sessionId,
        metadata.imageAttachments,
      ),
    },
    changed: true,
  };
}

export function slimImageAttachmentsForIpc(attachments: unknown): PersistedCoworkImageAttachment[] | undefined {
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined;
  const slim = attachments
    .filter(isRecord)
    .slice(0, 40)
    .map(item => {
      const name = typeof item.name === 'string' ? item.name : '';
      const mimeType = typeof item.mimeType === 'string' ? item.mimeType : '';
      const filePath = typeof item.path === 'string' ? item.path : '';
      return filePath ? { name, mimeType, path: filePath } : null;
    })
    .filter((item): item is PersistedCoworkImageAttachment => item !== null);
  return slim.length > 0 ? slim : undefined;
}

export function slimQueuedMessagesForIpc<T>(items: T[]): T[] {
  if (!Array.isArray(items)) return items;
  return items.map(item => {
    if (!isRecord(item) || !('imageAttachments' in item)) return item;
    const slim = slimImageAttachmentsForIpc(item.imageAttachments);
    const next: Record<string, unknown> = { ...item };
    if (slim) next.imageAttachments = slim;
    else delete next.imageAttachments;
    return next as T;
  });
}

export function readCoworkImageBase64(attachment: {
  base64Data?: string;
  path?: string;
}): string {
  if (attachment.base64Data) {
    const comma = attachment.base64Data.indexOf(',');
    return attachment.base64Data.startsWith('data:') && comma >= 0
      ? attachment.base64Data.slice(comma + 1)
      : attachment.base64Data;
  }
  if (!attachment.path) return '';
  try {
    return fs.readFileSync(attachment.path).toString('base64');
  } catch (error) {
    console.error('[CoworkImages] failed to read persisted image:', error);
    return '';
  }
}

export function deleteCoworkSessionImages(rootDir: string, sessionId: string): void {
  fs.rmSync(path.join(rootDir, sanitizeSessionId(sessionId)), { recursive: true, force: true });
}
