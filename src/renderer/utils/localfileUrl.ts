import { normalizeArtifactPath } from '../../shared/cowork/artifactPath';

/** Preserve web images; encode native filenames without turning #/?/% into URL syntax. */
export function toLocalfileUrl(filePath: string): string {
  if (!filePath || filePath.startsWith('inline:')) return '';
  if (/^(?:https?|data|blob|localfile):/i.test(filePath)) return filePath;
  const normalized = normalizeArtifactPath(filePath);
  const withLeading = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encoded = withLeading
    .split('/')
    .map(encodeURIComponent)
    .join('/')
    .replace(/^\/([a-z])%3A/i, '/$1:');
  return new URL(`localfile://${encoded}`).href;
}
