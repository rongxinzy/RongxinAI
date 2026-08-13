import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MediaMarker } from './types';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'amr', 'm4a', 'aac']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm']);
const FILE_EXTENSIONS = new Set([
  'txt',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'json',
  'xml',
  'csv',
  'md',
  'html',
  'htm',
  'js',
  'ts',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'sh',
]);
const LOCAL_PATH_SOURCE = String.raw`(?:file:\/\/\/(?:[^)\s]+)|\/(?:tmp|var|private|Users|home|root)\/[^)\s]+|~\/[^)\s]+|[A-Za-z]:[\\/][^)\s]+)`;
const MARKDOWN_IMAGE_RE = new RegExp(String.raw`!\[([^\]]*)\]\((${LOCAL_PATH_SOURCE})\)`, 'g');
const MARKDOWN_LINK_RE = new RegExp(String.raw`\[([^\]]*)\]\((${LOCAL_PATH_SOURCE})\)`, 'g');
const BARE_PATH_RE = new RegExp(
  String.raw`(?:^|\s)(${LOCAL_PATH_SOURCE})\.(png|jpg|jpeg|gif|bmp|webp|mp3|wav|ogg|amr|m4a|aac|mp4|mov|avi|mkv|webm|txt|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|tar|gz|json|xml|csv|md|html|htm|js|ts|py|java|c|cpp|h|cs|go|rs|rb|php|sh)(?=\s|$|[,.])`,
  'gi',
);
const LEGACY_MARKER_RE = /\[DINGTALK_(VIDEO|AUDIO|FILE)\](\{[\s\S]*?\})\[\/DINGTALK_\1\]/g;

export function parseMediaMarkers(text: string): MediaMarker[] {
  const markers: MediaMarker[] = [];
  const paths = new Set<string>();
  const add = (marker: MediaMarker): void => {
    if (!paths.has(marker.path)) {
      paths.add(marker.path);
      markers.push(marker);
    }
  };

  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    add({
      type: 'image',
      path: cleanLocalPath(match[2]),
      name: match[1].trim() || undefined,
      originalMarker: match[0],
    });
  }
  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    const localPath = cleanLocalPath(match[2]);
    const type = mediaType(localPath);
    if (type) {
      add({ type, path: localPath, name: match[1].trim() || undefined, originalMarker: match[0] });
    }
  }
  for (const match of text.matchAll(BARE_PATH_RE)) {
    const localPath = cleanLocalPath(`${match[1]}.${match[2]}`);
    const type = mediaType(localPath);
    if (type) add({ type, path: localPath, originalMarker: match[0].trim() });
  }
  for (const match of text.matchAll(LEGACY_MARKER_RE)) {
    try {
      const value = JSON.parse(match[2]) as { path?: unknown; name?: unknown; fileName?: unknown };
      if (typeof value.path !== 'string') continue;
      const type = match[1].toLowerCase() as 'video' | 'audio' | 'file';
      add({
        type,
        path: cleanLocalPath(value.path),
        name:
          typeof value.name === 'string'
            ? value.name
            : typeof value.fileName === 'string'
              ? value.fileName
              : undefined,
        originalMarker: match[0],
      });
    } catch {
      // Malformed legacy markers remain plain text.
    }
  }
  return markers;
}

export function stripMediaMarkers(text: string, markers: readonly MediaMarker[]): string {
  let result = text;
  for (const marker of markers) result = result.replace(marker.originalMarker, '');
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

function cleanLocalPath(value: string): string {
  const decoded = value.startsWith('file:///')
    ? fileURLToPath(value)
    : value.replace(/\\ /g, ' ');
  return decoded.startsWith('~/')
    ? path.join(process.env.USERPROFILE || process.env.HOME || '', decoded.slice(2))
    : decoded;
}

function mediaType(filePath: string): MediaMarker['type'] | null {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (FILE_EXTENSIONS.has(extension)) return 'file';
  return null;
}
