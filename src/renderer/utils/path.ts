export const getLastPathSegment = (rawPath: string): string => {
  const trimmed = rawPath.trim();
  if (!trimmed) return '';

  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/, '');
  const normalized = withoutTrailingSeparators || trimmed;
  const parts = normalized.split(/[\\/]+/).filter(Boolean);

  if (parts.length === 0) {
    return normalized;
  }

  return parts[parts.length - 1];
};

export const getCompactFolderName = (rawPath: string, maxLength?: number): string => {
  const folderName = getLastPathSegment(rawPath);
  if (!folderName) return '';

  if (typeof maxLength === 'number' && maxLength > 0 && folderName.length > maxLength) {
    return folderName.slice(-maxLength);
  }

  return folderName;
};

/**
 * Matches the shared scratch workspace directory created by the
 * `project:ensureScratchDir` IPC (`<home>/.zhiyuan/scratch`). Used to display
 * that workspace as 「无项目」 instead of its folder basename.
 */
export const isScratchWorkspacePath = (rawPath: string): boolean => {
  const normalized = rawPath.trim().replace(/[\\/]+$/, '');
  return /[\\/]\.zhiyuan[\\/]scratch$/i.test(normalized);
};
