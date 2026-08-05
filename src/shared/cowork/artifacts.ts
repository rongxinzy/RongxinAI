export type CoworkArtifactType =
  | 'html'
  | 'svg'
  | 'image'
  | 'mermaid'
  | 'code'
  | 'markdown'
  | 'text'
  | 'document';

export const CoworkArtifactSource = {
  CodeBlock: 'codeblock',
  Tool: 'tool',
} as const;

export type CoworkArtifactSource = (typeof CoworkArtifactSource)[keyof typeof CoworkArtifactSource];

export const CoworkArtifactRole = {
  Intermediate: 'intermediate',
  Deliverable: 'deliverable',
} as const;

export type CoworkArtifactRole = (typeof CoworkArtifactRole)[keyof typeof CoworkArtifactRole];

export interface CoworkPersistedArtifact {
  id: string;
  messageId: string;
  type: CoworkArtifactType;
  title: string;
  content: string;
  language?: string;
  fileName?: string;
  filePath?: string;
  source: CoworkArtifactSource;
  role: CoworkArtifactRole;
  declared: boolean;
  createdAt: number;
}
