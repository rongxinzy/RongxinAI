export type CoworkArtifactType =
  | 'html'
  | 'svg'
  | 'image'
  | 'mermaid'
  | 'code'
  | 'markdown'
  | 'text'
  | 'document'
  | 'model'
  | 'unsupported';

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
  /** Producing tool call, when known — anchors the preview card. */
  toolCallId?: string | null;
  /** Workbench run that produced the artifact, when known. */
  runId?: string | null;
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
