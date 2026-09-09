const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const URL_PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

const stripHashAndQuery = (value: string): string => value.split('#')[0].split('?')[0];

const normalizePath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');

const normalizeWorkspacePath = (value: string): string | null => {
  const segments: string[] = [];
  for (const segment of normalizePath(value).split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
};

export const resolveWorkspaceMarkdownLink = (
  href: string,
  sourceRoot: string,
  markdownPath: string,
): string | null => {
  const target = stripHashAndQuery(href.trim());
  if (!target || target.startsWith('/') || target.startsWith('\\')) return null;
  if (WINDOWS_DRIVE_PATH_PATTERN.test(target) || URL_PROTOCOL_PATTERN.test(target)) return null;

  const currentDirectory = normalizePath(markdownPath).split('/').slice(0, -1).join('/');
  const relativeTarget = normalizeWorkspacePath(
    currentDirectory ? `${currentDirectory}/${target}` : target,
  );
  if (relativeTarget === null) return null;

  const normalizedRoot = normalizePath(sourceRoot);
  return relativeTarget ? `${normalizedRoot}/${relativeTarget}` : normalizedRoot;
};
