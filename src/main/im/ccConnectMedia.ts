import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  CcConnectInboundAudio,
  CcConnectInboundFile,
  CcConnectInboundImage,
  CcConnectTurnResponse,
} from '../libs/ccConnectBridgeServer';
import { parseMediaMarkers, stripMediaMarkers } from './channelMediaMarkers';
import type { IMMediaAttachment, MediaMarker } from './types';

const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export async function persistCcConnectMedia(input: {
  workspacePath: string;
  accountId: string;
  messageId: string;
  images?: readonly CcConnectInboundImage[];
  files?: readonly CcConnectInboundFile[];
  audio?: CcConnectInboundAudio;
}): Promise<IMMediaAttachment[]> {
  const entries = [
    ...(input.images ?? []).map(item => ({ type: 'image' as const, item })),
    ...(input.files ?? []).map(item => ({ type: 'document' as const, item })),
    ...(input.audio ? [{ type: 'audio' as const, item: input.audio }] : []),
  ];
  if (entries.length === 0) return [];

  const decoded = entries.map(({ type, item }, index) => ({
    type,
    data: decodeBase64(item.Data),
    mimeType: item.MimeType.trim() || 'application/octet-stream',
    fileName: safeFileName(
      'FileName' in item ? item.FileName : undefined,
      type,
      item.MimeType,
      index,
    ),
    duration: 'Duration' in item && Number.isFinite(item.Duration) ? item.Duration : undefined,
  }));
  const totalBytes = decoded.reduce((total, item) => total + item.data.length, 0);
  if (totalBytes > MAX_MEDIA_BYTES)
    throw new Error('Channel media exceeds the 100 MiB bridge limit');

  const workspaceRoot = await fs.realpath(input.workspacePath);
  const directory = await createAttachmentDirectory(workspaceRoot, [
    '.zhiyuan',
    'channel-attachments',
    stableSegment(input.accountId),
    `${stableSegment(input.messageId)}-${crypto.randomUUID()}`,
  ]);

  const attachments: IMMediaAttachment[] = [];
  try {
    for (const [index, item] of decoded.entries()) {
      const filePath = path.join(directory, `${index + 1}-${item.fileName}`);
      await fs.writeFile(filePath, item.data, { flag: 'wx' });
      attachments.push({
        type: item.type,
        localPath: filePath,
        mimeType: item.mimeType,
        fileName: item.fileName,
        fileSize: item.data.length,
        duration: item.duration,
      });
    }
    return attachments;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch((): void => undefined);
    throw error;
  }
}

export async function buildCcConnectTurnResponse(text: string): Promise<CcConnectTurnResponse> {
  const markers = parseMediaMarkers(text);
  const accepted: MediaMarker[] = [];
  const attachments: CcConnectTurnResponse['attachments'] = [];
  for (const marker of markers) {
    const attachment = await inspectOutgoingAttachment(marker);
    if (!attachment) continue;
    accepted.push(marker);
    attachments.push(attachment);
  }
  return {
    content: stripMediaMarkers(text, accepted),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

async function inspectOutgoingAttachment(
  marker: MediaMarker,
): Promise<NonNullable<CcConnectTurnResponse['attachments']>[number] | null> {
  if (!path.isAbsolute(marker.path)) return null;
  let stats;
  try {
    stats = await fs.lstat(marker.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (stats.isSymbolicLink()) throw new Error('Channel reply attachments cannot be symbolic links');
  if (!stats.isFile()) throw new Error('Channel reply attachments must be regular files');
  if (stats.size > MAX_MEDIA_BYTES) throw new Error('Channel reply attachment exceeds 100 MiB');
  const resolvedPath = await fs.realpath(marker.path);
  if (!samePath(resolvedPath, path.resolve(marker.path))) {
    throw new Error('Channel reply attachment paths cannot contain symbolic links');
  }
  return {
    kind: marker.type === 'image' ? 'image' : 'file',
    path: marker.path,
    fileName: marker.name || path.basename(marker.path),
  };
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s/g, '');
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    throw new Error('Channel media contains invalid base64 data');
  }
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length === 0) {
    throw new Error('Channel media contains invalid base64 data');
  }
  return decoded;
}

function safeFileName(
  value: string | undefined,
  type: 'image' | 'document' | 'audio',
  mimeType: string,
  index: number,
): string {
  const fallbackExtension = extensionForMimeType(mimeType);
  const fallback = `${type}-${index + 1}${fallbackExtension}`;
  const base = path
    .basename(value?.trim() || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 160);
  return base || fallback;
}

function extensionForMimeType(mimeType: string): string {
  const subtype = mimeType.split(';', 1)[0].split('/')[1]?.toLowerCase();
  if (!subtype || !/^[a-z0-9.+-]+$/.test(subtype)) return '';
  const normalized = subtype === 'jpeg' ? 'jpg' : subtype === 'plain' ? 'txt' : subtype;
  return `.${normalized}`;
}

function stableSegment(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

async function createAttachmentDirectory(
  root: string,
  segments: readonly string[],
): Promise<string> {
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      await fs.mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stats = await fs.lstat(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('Channel attachment directories must be real directories');
    }
  }
  return current;
}
