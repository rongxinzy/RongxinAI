export const ArtifactWorkerLimit = {
  Workers: 2,
  Queue: 16,
  Candidates: 256,
  InputBytes: 2_000_000,
  FileBytes: 128 * 1024 * 1024,
  TimeoutMs: 30_000,
} as const;
