/**
 * Main-process local path resolver for chat markdown links (issue #805).
 *
 * The renderer only supplies raw candidates (inline code spans and non-http
 * link hrefs from the markdown AST); this module owns path truth: candidate
 * validation, cwd-relative resolution, file:// URL decoding and the allowed
 * probe-roots policy. A candidate resolves only when it points at an existing
 * regular file inside an allowed root.
 */
import fs from 'fs';

import path from 'path';

import { fileURLToPath } from 'url';

import { isAllowedShellProbePath } from './shellPathValidation';
import { normalizeWindowsShellPath } from './shellIpc/shellPathNormalize';

const MAX_LOCAL_PATH_CANDIDATE_LENGTH = 1024;

const FILE_URL_PATTERN = /^file:\/\//i;

const isPlainCandidate = (candidate: string): boolean => {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_LOCAL_PATH_CANDIDATE_LENGTH) return false;
  if (trimmed.includes('\0') || /[\r\n]/.test(trimmed)) return false;
  // Scheme-bearing candidates other than file: URLs are not local paths.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !FILE_URL_PATTERN.test(trimmed)) return false;
  return true;
};

const fileUrlToCandidate = (candidate: string): string | null => {
  try {
    return fileURLToPath(candidate);
  } catch {
    return null;
  }
};

/**
 * Resolve a renderer-supplied candidate into an existing file path.
 * Returns the absolute path, or null when the candidate is malformed, points
 * outside the allowed roots, or does not exist as a regular file.
 */
export const resolveLocalPathCandidate = async (
  candidate: string,
  cwd: string | undefined,
  allowedRoots: string[],
): Promise<string | null> => {
  if (typeof candidate !== 'string') return null;

  const trimmed = candidate.trim();
  if (!isPlainCandidate(trimmed)) return null;

  let rawPath = trimmed;
  if (FILE_URL_PATTERN.test(rawPath)) {
    const fromUrl = fileUrlToCandidate(rawPath);
    if (!fromUrl) return null;
    rawPath = fromUrl;
  }

  const normalized = normalizeWindowsShellPath(rawPath);
  // A relative candidate needs the session cwd; never resolve it against the
  // main process's own working directory.
  if (!path.isAbsolute(normalized) && !cwd) return null;
  const resolved = cwd ? path.resolve(cwd, normalized) : path.resolve(normalized);
  if (!isAllowedShellProbePath(resolved, allowedRoots)) return null;

  try {
    const stats = await fs.promises.stat(resolved);
    if (!stats.isFile()) return null;
  } catch {
    return null;
  }
  return resolved;
};
