export function toLocalFileUrl(filePath: string): string {
  if (/^file:/i.test(filePath)) return filePath;

  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileUrl = new URL('file:///');
  fileUrl.pathname = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  return fileUrl.href;
}
