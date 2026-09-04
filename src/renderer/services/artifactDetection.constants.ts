export const ArtifactDetectionRequestKind = {
  Snapshot: 'snapshot',
  Patch: 'patch',
} as const;

export type ArtifactDetectionRequestKind =
  (typeof ArtifactDetectionRequestKind)[keyof typeof ArtifactDetectionRequestKind];
