// ── URI / path helpers ──

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const stripHashAndQuery = (value: string): string => value.split('#')[0].split('?')[0];

const stripFileProtocol = (value: string): string => {
  let cleaned = value.replace(/^file:\/\//i, '');
  if (/^\/[A-Za-z]:/.test(cleaned)) cleaned = cleaned.slice(1);
  return cleaned;
};

const hasScheme = (value: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(value);

const isAbsolutePath = (value: string): boolean =>
  value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);

const isRelativePath = (value: string): boolean => !isAbsolutePath(value) && !hasScheme(value);

/**
 * Parse `file:///root/path::relative/path` syntax into a single absolute path.
 * Returns null if the input does not match this format.
 */
const parseRootRelativePath = (value: string): string | null => {
  const trimmed = value.trim();
  if (!/^file:\/\//i.test(trimmed)) return null;
  const separatorIndex = trimmed.indexOf('::');
  if (separatorIndex < 0) return null;
  const rootPart = trimmed.slice(0, separatorIndex);
  const relativePart = trimmed.slice(separatorIndex + 2);
  if (!relativePart.trim()) return null;
  const rootPath = safeDecodeURIComponent(stripFileProtocol(stripHashAndQuery(rootPart)));
  const relativePath = safeDecodeURIComponent(stripHashAndQuery(relativePart));
  if (!rootPath || !relativePath) return null;
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '');
  const normalizedRelative = relativePath.replace(/^[\\/]+/, '');
  if (!normalizedRelative) return null;
  return `${normalizedRoot}/${normalizedRelative}`;
};

/**
 * Normalize a potentially-file-scheme path string into its decoded local form.
 */
const normalizeLocalPath = (
  value: string,
): { path: string; isRelative: boolean; isAbsolute: boolean } | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fileScheme = /^file:\/\//i.test(trimmed);
  const schemePresent = hasScheme(trimmed);
  if (schemePresent && !fileScheme && !isAbsolutePath(trimmed)) return null;
  let raw = trimmed;
  if (fileScheme) raw = stripFileProtocol(raw);
  raw = stripHashAndQuery(raw);
  const decoded = safeDecodeURIComponent(raw);
  const path = decoded || raw;
  if (!path) return null;
  const isAbsolute = isAbsolutePath(path);
  const isRelative = isRelativePath(path);
  return { path, isRelative, isAbsolute };
};

const toAbsolutePathFromCwd = (filePath: string, cwd: string): string => {
  if (isAbsolutePath(filePath)) return filePath;
  return `${cwd.replace(/\/$/, '')}/${filePath.replace(/^\.\//, '')}`;
};

/**
 * Resolve a link href (or its label text) against the session cwd into an
 * absolute local path, or null when neither side looks like a local path.
 * Priority: root-relative `file://` href, href path, root-relative text,
 * text path.
 */
export const resolveLocalFilePath = (href: string, text: string, cwd?: string): string | null => {
  const hrefValue = typeof href === 'string' ? href.trim() : '';
  const textValue = typeof text === 'string' ? text.trim() : '';
  if (!hrefValue && !textValue) return null;

  const hrefRootRelative = hrefValue ? parseRootRelativePath(hrefValue) : null;
  if (hrefRootRelative) {
    return hrefRootRelative;
  }

  const hrefPath = hrefValue ? normalizeLocalPath(hrefValue) : null;
  if (hrefPath) {
    if (hrefPath.isRelative && cwd) {
      return toAbsolutePathFromCwd(hrefPath.path, cwd);
    }
    if (hrefPath.isAbsolute) {
      return hrefPath.path;
    }
  }

  const textRootRelative = textValue ? parseRootRelativePath(textValue) : null;
  if (textRootRelative) {
    return textRootRelative;
  }

  const textPath = textValue ? normalizeLocalPath(textValue) : null;
  if (textPath) {
    if (textPath.isRelative && cwd) {
      return toAbsolutePathFromCwd(textPath.path, cwd);
    }
    if (textPath.isAbsolute) {
      return textPath.path;
    }
  }

  return null;
};
