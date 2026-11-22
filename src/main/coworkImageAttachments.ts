import { randomUUID } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { isRecord } from '../shared/lib/isRecord';
import type { CoworkStore } from './coworkStore';
import { removeSessionDirectory } from './removeSessionDirectory';
import { CoworkImageLimit } from './workbenchTask/artifactWorkerConstants';
import { decodeCoworkImageAsync, readCoworkImageAsync } from './workbenchTask/artifactWorkerPool';

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};
const IMAGE_STAGING_DIR = '.staging';
const PENDING_START_IMAGES_DIR = '.pending-starts';
const IMAGE_WRITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface PersistedCoworkImageAttachment {
  name: string;
  mimeType: string;
  path: string;
  base64Data?: string;
}

export const coworkImageRoot = (userDataDir: string): string =>
  path.join(userDataDir, 'cowork-images');

const sanitizeSessionId = (sessionId: string): string => {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return safe || 'session';
};

const sanitizeFileName = (value: string): string => {
  const base = path
    .basename(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .trim();
  return base || 'image';
};

const extensionFor = (fileName: string, mimeType: string): string => {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName && fromName.length <= 8) return fromName;
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  return MIME_EXTENSION_MAP[normalized] ?? '.img';
};

type ImageWriteOwner = { signal?: AbortSignal; isCurrent?: () => boolean };

export async function persistCoworkImageAttachments(
  rootDir: string,
  sessionId: string,
  attachments: unknown,
  owner: ImageWriteOwner = {},
): Promise<PersistedCoworkImageAttachment[]> {
  if (!Array.isArray(attachments)) return [];
  const dir = path.join(rootDir, sanitizeSessionId(sessionId));
  const stored: PersistedCoworkImageAttachment[] = [];
  const assertCurrent = () => {
    owner.signal?.throwIfAborted();
    if (owner.isCurrent?.() === false)
      throw new DOMException('The session ended before images were saved.', 'AbortError');
  };

  for (const item of attachments) {
    assertCurrent();
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

    const decoded = await decodeCoworkImageAsync(base64Data, owner.signal);
    assertCurrent();
    if (!decoded) {
      console.warn(`[CoworkImages] skipped an invalid or oversized image for ${sessionId}`);
      continue;
    }

    const filePath = path.join(dir, `${decoded.hash}${extensionFor(name, mimeType)}`);
    if (!fs.existsSync(filePath)) {
      const staging = path.join(rootDir, IMAGE_STAGING_DIR);
      await fs.promises.mkdir(staging, { recursive: true });
      const stagedFile = path.join(staging, randomUUID());
      try {
        await fs.promises.writeFile(stagedFile, new Uint8Array(decoded.bytes), {
          flag: 'wx',
          mode: 0o600,
          signal: owner.signal,
        });
        // The owner check and rename must share a turn with session deletion.
        assertCurrent();
        fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(filePath)) fs.renameSync(stagedFile, filePath);
      } finally {
        await fs.promises.rm(stagedFile, { force: true }).catch((error: unknown) => {
          console.warn(`[CoworkImages] failed to clean a staged image for ${sessionId}:`, error);
        });
      }
    }
    assertCurrent();
    stored.push({ name, mimeType, path: filePath });
  }

  return stored;
}

export function hasInlineCoworkImages(attachments: unknown): boolean {
  return (
    Array.isArray(attachments) &&
    attachments.some(
      item => isRecord(item) && typeof item.base64Data === 'string' && item.base64Data.length > 0,
    )
  );
}

export async function persistInlineMessageImages(
  rootDir: string,
  sessionId: string,
  metadata: unknown,
  owner: ImageWriteOwner,
): Promise<PersistedCoworkImageAttachment[] | null> {
  const attachments = isRecord(metadata) ? metadata.imageAttachments : undefined;
  if (!Array.isArray(attachments) || !hasInlineCoworkImages(attachments)) return null;
  const images = await persistCoworkImageAttachments(rootDir, sessionId, attachments, owner);
  return images.length === attachments.length ? images : null;
}

export async function removeAbandonedCoworkImageWrites(rootDir: string): Promise<void> {
  const staging = path.join(rootDir, IMAGE_STAGING_DIR);
  const entries = await fs.promises
    .readdir(staging, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException): fs.Dirent[] => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  for (const entry of entries) {
    if (entry.isFile() && IMAGE_WRITE_ID.test(entry.name)) {
      await fs.promises.rm(path.join(staging, entry.name), { force: true });
    }
  }
}

type StartMessageStore = Pick<CoworkStore, 'messages'>;

function startImageDirectories(imageRoot: string, sessionId: string) {
  const stagingRoot = path.join(imageRoot, PENDING_START_IMAGES_DIR);
  return {
    stagingRoot,
    staged: path.join(stagingRoot, sessionId),
    published: path.join(imageRoot, sessionId),
  };
}

function isImageChild(dir: string, file: unknown): file is string {
  if (typeof file !== 'string' || path.dirname(file) !== dir) return false;
  const name = path.basename(file);
  return name !== '.' && name !== '..';
}

export async function stageCoworkStartImages(
  imageRoot: string,
  sessionId: string,
  attachments: unknown,
  owner: ImageWriteOwner,
): Promise<PersistedCoworkImageAttachment[]> {
  const { stagingRoot, staged, published } = startImageDirectories(imageRoot, sessionId);
  const images = await persistCoworkImageAttachments(stagingRoot, sessionId, attachments, owner);
  return images.map(image =>
    isImageChild(staged, image.path)
      ? { ...image, path: path.join(published, path.basename(image.path)) }
      : image,
  );
}

function startMessageReferencesStagedImages(
  store: StartMessageStore,
  sessionId: string,
  staged: string,
  published: string,
): boolean {
  const [message] = store.messages.getPagedSessionMessages(sessionId, 1, 0);
  const attachments = message?.metadata?.imageAttachments;
  return (
    message?.type === 'user' &&
    Array.isArray(attachments) &&
    attachments.some(
      item =>
        isRecord(item) &&
        isImageChild(published, item.path) &&
        fs
          .lstatSync(path.join(staged, path.basename(item.path)), { throwIfNoEntry: false })
          ?.isFile(),
    )
  );
}

export function publishCoworkStartImages(imageRoot: string, sessionId: string): void {
  const { staged, published } = startImageDirectories(imageRoot, sessionId);
  if (!fs.lstatSync(staged, { throwIfNoEntry: false })?.isDirectory()) return;
  if (fs.lstatSync(published, { throwIfNoEntry: false })) {
    throw new Error('The session image directory already exists.');
  }
  fs.renameSync(staged, published);
}

export async function discardUncommittedCoworkStartImages(
  imageRoot: string,
  sessionId: string,
  store: StartMessageStore,
): Promise<void> {
  const { staged, published } = startImageDirectories(imageRoot, sessionId);
  if (!startMessageReferencesStagedImages(store, sessionId, staged, published)) {
    await fs.promises.rm(staged, { recursive: true, force: true });
  }
}

export async function recoverPendingCoworkStartImages(
  imageRoot: string,
  store: StartMessageStore,
): Promise<void> {
  const stagingRoot = path.join(imageRoot, PENDING_START_IMAGES_DIR);
  if (!fs.lstatSync(stagingRoot, { throwIfNoEntry: false })?.isDirectory()) return;
  if (
    fs
      .lstatSync(path.join(stagingRoot, IMAGE_STAGING_DIR), { throwIfNoEntry: false })
      ?.isDirectory()
  ) {
    await removeAbandonedCoworkImageWrites(stagingRoot).catch((error: unknown) => {
      console.warn('[CoworkImages] failed to clean abandoned initial image writes:', error);
    });
  }
  const entries = await fs.promises.readdir(stagingRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !IMAGE_WRITE_ID.test(entry.name)) continue;
    const { staged, published } = startImageDirectories(imageRoot, entry.name);
    try {
      if (startMessageReferencesStagedImages(store, entry.name, staged, published)) {
        publishCoworkStartImages(imageRoot, entry.name);
      } else {
        await fs.promises.rm(staged, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn(`[CoworkImages] failed to recover initial images for ${entry.name}:`, error);
    }
  }
}

export function slimImageAttachmentsForIpc(
  attachments: unknown,
): PersistedCoworkImageAttachment[] | undefined {
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined;
  const slim = attachments
    .filter(isRecord)
    .slice(0, 40)
    .map((item): PersistedCoworkImageAttachment | null => {
      const name = typeof item.name === 'string' ? item.name : '';
      const mimeType = typeof item.mimeType === 'string' ? item.mimeType : '';
      const filePath = typeof item.path === 'string' ? item.path : '';
      if (filePath) {
        return { name, mimeType, path: filePath };
      }
      const base64Data = typeof item.base64Data === 'string' ? item.base64Data : '';
      if (base64Data) {
        return { name, mimeType, path: '', base64Data };
      }
      return null;
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

export function readCoworkImageBase64(
  attachment: { base64Data?: string; path?: string },
  signal?: AbortSignal,
): string | Promise<string> {
  const { base64Data, path: filePath } = attachment;
  if (base64Data) {
    const comma = base64Data.startsWith('data:')
      ? base64Data.slice(0, CoworkImageLimit.DataUrlHeaderCharacters).indexOf(',')
      : -1;
    const payload = comma < 0 ? base64Data : base64Data.slice(comma + 1);
    return payload.length <= CoworkImageLimit.Base64Characters ? payload : '';
  }
  if (!filePath || !path.isAbsolute(filePath)) return '';
  return readCoworkImageAsync(filePath, signal).catch((error: unknown): string => {
    signal?.throwIfAborted();
    console.warn('[CoworkImages] failed to read persisted image:', error);
    return '';
  });
}

export function deleteCoworkSessionImages(rootDir: string, sessionId: string): Promise<void> {
  return removeSessionDirectory(path.join(rootDir, sanitizeSessionId(sessionId)));
}
