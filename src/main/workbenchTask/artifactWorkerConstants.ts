export const ArtifactWorkerLimit = {
  Workers: 2,
  Queue: 16,
  Candidates: 256,
  InputBytes: 2_000_000,
  FileBytes: 128 * 1024 * 1024,
  TimeoutMs: 30_000,
  WorkspaceContentBytes: 512 * 1024,
} as const;

const coworkImageBytes = 25 * 1024 * 1024;
export const CoworkImageLimit = {
  Bytes: coworkImageBytes,
  Base64Characters: Math.ceil(coworkImageBytes / 3) * 4,
  DataUrlHeaderCharacters: 1024,
} as const;

export const ArtifactWorkerTask = {
  TransformText: 'transform-text',
  InspectWorkspaceContent: 'inspect-workspace-content',
  PrepareCompanionImages: 'prepare-companion-images',
  DecodeCoworkImage: 'decode-cowork-image',
  ReadCoworkImage: 'read-cowork-image',
  ScanLocalModels: 'scan-local-models',
  ReadSkillCatalog: 'read-skill-catalog',
  ReadMcpMarketplace: 'read-mcp-marketplace',
  FindSkillSourceDirs: 'find-skill-source-dirs',
  ReadPresetMembers: 'read-preset-members',
  ReadPresetCatalog: 'read-preset-catalog',
  ReadPresetExpert: 'read-preset-expert',
  ReadGgufPlacement: 'read-gguf-placement',
  VerifyModelCatalog: 'verify-model-catalog',
} as const;
export type ArtifactWorkerTask = (typeof ArtifactWorkerTask)[keyof typeof ArtifactWorkerTask];
