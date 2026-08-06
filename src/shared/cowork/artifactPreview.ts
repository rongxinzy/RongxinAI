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
} as const;

export type ArtifactPreviewMode = (typeof ArtifactPreviewMode)[keyof typeof ArtifactPreviewMode];

export const ArtifactTypeByExtension = {
  '.html': 'html',
  '.htm': 'html',
  '.svg': 'svg',
  '.png': 'image',
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
  '.xls': 'document',
  '.docx': 'document',
  '.xlsx': 'document',
  '.pptx': 'document',
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
};

const BINARY_ARTIFACT_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.xls',
  '.xlsx',
  '.docx',
  '.pptx',
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
