export const ArtifactWorkerLimit = {
  Workers: 2,
  Queue: 16,
  Candidates: 256,
  InputBytes: 2_000_000,
  FileBytes: 128 * 1024 * 1024,
  TimeoutMs: 30_000,
  WorkspaceContentBytes: 512 * 1024,
} as const;

export const ArtifactWorkerTask = {
  Collect: 'collect',
  TransformText: 'transform-text',
  InspectWorkspaceContent: 'inspect-workspace-content',
} as const;
export type ArtifactWorkerTask = (typeof ArtifactWorkerTask)[keyof typeof ArtifactWorkerTask];
