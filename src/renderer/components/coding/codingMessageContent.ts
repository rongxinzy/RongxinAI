import { getFileName } from '../../services/artifactPaths';

const LOCAL_FILE_MARKDOWN_LINK_PATTERN =
  /!?\[([^\]\n]*)\]\(\s*<?(file:\/\/[^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gi;

const stripFileProtocol = (value: string): string => {
  let cleaned = value.replace(/^file:\/\//i, '');
  if (/^\/[A-Za-z]:/.test(cleaned)) cleaned = cleaned.slice(1);
  return cleaned;
};

/**
 * Streamdown blocks file:// URLs before custom link rendering. Coding turns
 * render matching ArtifactPreviewCard entries, so retain only the label.
 */
export const replaceLocalFileLinksWithLabels = (content: string): string =>
  content.replace(LOCAL_FILE_MARKDOWN_LINK_PATTERN, (_match, label: string, href: string) => {
    const visibleLabel = label.trim();
    return visibleLabel || getFileName(stripFileProtocol(href));
  });
