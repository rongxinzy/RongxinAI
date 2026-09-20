/** Convert a filesystem path into the privileged `localfile://` preview URL. */
export function toLocalfileUrl(filePath: string): string {
  if (!filePath || filePath.startsWith('inline:')) return '';
  if (/^localfile:/i.test(filePath)) return filePath;
  if (/^data:/i.test(filePath)) return filePath;
  if (/^file:/i.test(filePath)) {
    return filePath.replace(/^file:\/\//i, 'localfile://');
  }

  const normalized = filePath.replace(/\\/g, '/');
  const withLeading = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `localfile://${withLeading}`;
}
