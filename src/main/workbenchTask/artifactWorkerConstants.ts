export const ArtifactWorkerLimit = {
  Workers: 2,
  Queue: 16,
  Candidates: 256,
  InputBytes: 2_000_000,
  FileBytes: 128 * 1024 * 1024,
  TimeoutMs: 30_000,
  WorkspaceContentBytes: 512 * 1024,
  ImageBytes: 32 * 1024 * 1024,
  PendingImageBytes: 64 * 1024 * 1024,
  ImagePixels: 32_000_000,
  ImageDimension: 16_384,
  ImageOutputBytes: 8 * 1024 * 1024,
} as const;

export const ArtifactWorkerTask = {
  TransformText: 'transform-text',
  InspectWorkspaceContent: 'inspect-workspace-content',
  PrepareCompanionImages: 'prepare-companion-images',
  PrepareDurableImage: 'prepare-durable-image',
} as const;
export type ArtifactWorkerTask = (typeof ArtifactWorkerTask)[keyof typeof ArtifactWorkerTask];
