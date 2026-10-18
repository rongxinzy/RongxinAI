import type { ArtifactType } from '../types/artifact';
import { getArtifactTypeByExtension } from '../../shared/cowork/artifactPreview';

/**
 * Generic file-path helpers shared by artifact surfaces (coding collector,
 * link interception, store dedup). Kept free of any detection policy: these
 * only normalize and describe paths.
 */

/** Lowercased extension including the leading dot; `''` when there is none. */
export function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

/** Final path segment after the last separator (either slash direction). */
export function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}

/**
 * Normalize file path for deduplication comparison.
 * Handles Windows file:// URL leading slash and backslash differences.
 */
export function normalizeFilePathForDedup(p: string): string {
  p = p.replace(/^file:\/\/\/?/i, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    // Keep malformed percent-encoded paths unchanged for a stable comparison.
  }
  // Strip leading / before drive letter (e.g. /D:/path from file:///D:/path)
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  // Unify separators and case for comparison
  return p.replace(/\\/g, '/').toLowerCase();
}

/** Maps a lowercased extension (`.html`) to its artifact type, if supported. */
export function getArtifactTypeFromExtension(ext: string): ArtifactType | null {
  // `getArtifactTypeByExtension` extracts the extension of its argument, so a
  // bare `.ext` string resolves to itself.
  return getArtifactTypeByExtension(ext) as ArtifactType | null;
}
