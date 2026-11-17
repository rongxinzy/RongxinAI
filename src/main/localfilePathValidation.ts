import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_LOCALFILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
]);

const SENSITIVE_PATH_PATTERNS = [
  '/.ssh/',
  '/.gnupg/',
  '/.env',
  '/.git/',
  '/.aws/',
  'node_modules',
  'zhiyuan.sqlite',
  'zhiyuan.sqlite-wal',
  'zhiyuan.sqlite-shm',
  'etc/passwd',
  'etc/shadow',
  'windows/system32',
];

/**
 * Validates whether a file path requested via localfile:// protocol is allowed.
 *
 * Rules:
 * 1. Must be an absolute path after resolution.
 * 2. If it's located inside `allowedImageRoot` (e.g. userData/cowork-images), it is permitted.
 * 3. If outside `allowedImageRoot`, it MUST have a valid image extension and MUST NOT
 *    target sensitive files, credentials, hidden config directories, or the database.
 * 4. Path traversal sequences (../) are normalized by path.resolve.
 */
export function isAllowedLocalfilePath(resolvedPath: string, allowedImageRoot: string): boolean {
  if (!resolvedPath || typeof resolvedPath !== 'string') {
    return false;
  }

  const normalized = path.resolve(resolvedPath);
  const normalizedRoot = path.resolve(allowedImageRoot);

  // Check if inside allowedImageRoot
  const relativeToRoot = path.relative(normalizedRoot, normalized);
  if (!relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot)) {
    return true;
  }

  // Outside root: extension check
  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_LOCALFILE_EXTENSIONS.has(ext)) {
    return false;
  }

  // Block sensitive paths
  const posixPath = normalized.replace(/\\/g, '/').toLowerCase();
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (posixPath.includes(pattern)) {
      return false;
    }
  }

  return true;
}

/**
 * Resolves a custom `localfile://` request URL into a native OS path using
 * `node:url#fileURLToPath` semantics while ignoring cache-busting query/hash parts.
 */
export function resolveLocalfileRequestPath(
  requestUrl: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const parsed = new URL(requestUrl);
  if (parsed.protocol !== 'localfile:') {
    throw new TypeError(`Expected localfile: URL, got ${parsed.protocol}`);
  }
  const asFileUrl = new URL('file:///');
  asFileUrl.hostname = parsed.hostname;
  asFileUrl.pathname = parsed.pathname;

  if (platform === process.platform) {
    return fileURLToPath(asFileUrl);
  }

  let decoded = decodeURIComponent(asFileUrl.pathname);
  if (platform === 'win32') {
    if (asFileUrl.hostname && asFileUrl.hostname.toLowerCase() !== 'localhost') {
      decoded = `\\\\${asFileUrl.hostname}${decoded}`;
    } else if (/^\/[A-Za-z]:/.test(decoded)) {
      decoded = decoded.slice(1);
    }
    return path.win32.resolve(decoded);
  }
  return path.posix.resolve(decoded);
}
