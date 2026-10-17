import {
  CoworkArtifactRole,
  type CoworkArtifactRole as CoworkArtifactRoleValue,
  type CoworkArtifactSource,
  type CoworkArtifactType,
} from '../../shared/cowork/artifacts';

export {
  ArtifactPreviewMode,
  getArtifactPreviewMode,
  isBinaryArtifactFile,
} from '../../shared/cowork/artifactPreview';

export type ArtifactType = CoworkArtifactType;

export const PREVIEWABLE_ARTIFACT_TYPES = new Set<ArtifactType>([
  'html',
  'svg',
  'mermaid',
  'image',
  'code',
  'markdown',
  'text',
  'document',
  'model',
  'unsupported',
]);

type ArtifactSource = CoworkArtifactSource;

export const ArtifactRole = CoworkArtifactRole;

export type ArtifactRole = CoworkArtifactRoleValue;

export interface Artifact {
  id: string;
  messageId: string;
  sessionId: string;
  taskId?: string;
  runId?: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  fileName?: string;
  filePath?: string;
  source: ArtifactSource;
  role: ArtifactRole;
  declared?: boolean;
  createdAt: number;
}
