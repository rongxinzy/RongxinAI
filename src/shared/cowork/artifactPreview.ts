import type { CoworkArtifactType } from './artifacts';

/**
 * Canonical file-preview policy shared by artifact discovery and the renderer.
 * Preview-only files are binary or structured documents; source-only files are
 * intended to be read as text; the remaining formats support both views.
 */
export const ArtifactPreviewMode = {
  Preview: 'preview',
  Source: 'source',
  PreviewAndSource: 'preview-and-source',
  Unsupported: 'unsupported',
} as const;

export type ArtifactPreviewMode = (typeof ArtifactPreviewMode)[keyof typeof ArtifactPreviewMode];

export const ArtifactTypeByExtension = {
  '.doc': 'document',
  '.html': 'html',
  '.htm': 'html',
  '.svg': 'svg',
  '.png': 'image',
  '.bmp': 'image',
  '.ico': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.mermaid': 'mermaid',
  '.mmd': 'mermaid',
  '.jsx': 'code',
  '.tsx': 'code',
  '.js': 'code',
  '.mjs': 'code',
  '.cjs': 'code',
  '.ts': 'code',
  '.mts': 'code',
  '.cts': 'code',
  '.css': 'code',
  '.scss': 'code',
  '.less': 'code',
  '.json': 'code',
  '.yaml': 'code',
  '.yml': 'code',
  '.xml': 'code',
  '.py': 'code',
  '.java': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.md': 'markdown',
  '.txt': 'text',
  '.log': 'text',
  '.csv': 'document',
  '.tsv': 'document',
  '.dot': 'document',
  '.dotx': 'document',
  '.dotm': 'document',
  '.xls': 'document',
  '.xlt': 'document',
  '.xltx': 'document',
  '.xltm': 'document',
  '.xlam': 'document',
  '.docx': 'document',
  '.docm': 'document',
  '.xlsx': 'document',
  '.xlsm': 'document',
  '.ppt': 'document',
  '.pptx': 'document',
  '.pptm': 'document',
  '.pot': 'document',
  '.potx': 'document',
  '.potm': 'document',
  '.pps': 'document',
  '.ppsx': 'document',
  '.ppsm': 'document',
  '.pdf': 'document',
} as const satisfies Record<string, CoworkArtifactType>;

const ARTIFACT_PREVIEW_MODE_BY_TYPE: Record<CoworkArtifactType, ArtifactPreviewMode> = {
  html: ArtifactPreviewMode.PreviewAndSource,
  svg: ArtifactPreviewMode.PreviewAndSource,
  image: ArtifactPreviewMode.Preview,
  mermaid: ArtifactPreviewMode.PreviewAndSource,
  code: ArtifactPreviewMode.Source,
  markdown: ArtifactPreviewMode.PreviewAndSource,
  text: ArtifactPreviewMode.Source,
  document: ArtifactPreviewMode.Preview,
  unsupported: ArtifactPreviewMode.Unsupported,
};

const BINARY_ARTIFACT_EXTENSIONS = new Set([
  '.png',
  '.bmp',
  '.ico',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.xls',
  '.xlt',
  '.xltx',
  '.xltm',
  '.xlam',
  '.xlsm',
  '.doc',
  '.xlsx',
  '.docx',
  '.docm',
  '.dot',
  '.dotx',
  '.dotm',
  '.ppt',
  '.pptx',
  '.pptm',
  '.pot',
  '.potx',
  '.potm',
  '.pps',
  '.ppsx',
  '.ppsm',
  '.pdf',
]);

export function getArtifactExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  return lastDot === -1 ? '' : filePath.slice(lastDot).toLowerCase();
}

export function getArtifactTypeByExtension(filePath: string): CoworkArtifactType | null {
  const extension = getArtifactExtension(filePath) as keyof typeof ArtifactTypeByExtension;
  return ArtifactTypeByExtension[extension] ?? null;
}

export function getArtifactPreviewMode(type: CoworkArtifactType): ArtifactPreviewMode {
  return ARTIFACT_PREVIEW_MODE_BY_TYPE[type];
}

export function isBinaryArtifactFile(filePath: string): boolean {
  return BINARY_ARTIFACT_EXTENSIONS.has(getArtifactExtension(filePath));
}
