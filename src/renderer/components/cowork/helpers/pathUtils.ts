// ── URI / path helpers ──

export const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const stripHashAndQuery = (value: string): string => value.split('#')[0].split('?')[0];

export const stripFileProtocol = (value: string): string => {
  let cleaned = value.replace(/^file:\/\//i, '');
  if (/^\/[A-Za-z]:/.test(cleaned)) cleaned = cleaned.slice(1);
  return cleaned;
};

export const hasScheme = (value: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(value);

export const isAbsolutePath = (value: string): boolean =>
  value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);

export const isRelativePath = (value: string): boolean =>
  !isAbsolutePath(value) && !hasScheme(value);

/**
 * Parse `file:///root/path::relative/path` syntax into a single absolute path.
 * Returns null if the input does not match this format.
 */
export const parseRootRelativePath = (value: string): string | null => {
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
export const normalizeLocalPath = (
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

export const toAbsolutePathFromCwd = (filePath: string, cwd: string): string => {
  if (isAbsolutePath(filePath)) return filePath;
  return `${cwd.replace(/\/$/, '')}/${filePath.replace(/^\.\//, '')}`;
};
