import {
  CoworkArtifactRole,
  type CoworkArtifactRole as CoworkArtifactRoleValue,
  type CoworkArtifactSource,
  type CoworkArtifactType,
} from '../../shared/cowork/artifacts';

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
]);

export type ArtifactSource = CoworkArtifactSource;

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

export interface ArtifactMarker {
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  fullMatch: string;
}
