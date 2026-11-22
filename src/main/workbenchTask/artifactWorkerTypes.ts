import type { TextWorkerInput } from './textWorkerOperations';
import { ArtifactWorkerTask } from './artifactWorkerConstants';
import type { SkillCatalogInput } from '../skills/skillRecords';
import type { CompanionImageSource } from '../../shared/companion/images';
import type { readPresetMemberProfiles } from '../presetExpertSnapshot';
import type { VerifyModelCatalogUpdateInput } from '../libs/modelCatalogUpdateTypes';

export interface WorkspaceContentInspection {
  sha256: string;
  text: string;
  binary: boolean;
}

export interface DecodedCoworkImage {
  bytes: ArrayBuffer;
  hash: string;
}

export type ArtifactWorkerInput =
  | { kind: typeof ArtifactWorkerTask.TransformText; input: TextWorkerInput }
  | {
      kind: typeof ArtifactWorkerTask.PrepareCompanionImages;
      input: { sources: CompanionImageSource[] };
    }
  | { kind: typeof ArtifactWorkerTask.DecodeCoworkImage; input: { data: string } }
  | { kind: typeof ArtifactWorkerTask.ReadCoworkImage; input: { filePath: string } }
  | { kind: typeof ArtifactWorkerTask.ScanLocalModels; input: { modelsDir: string } }
  | { kind: typeof ArtifactWorkerTask.ReadSkillCatalog; input: SkillCatalogInput }
  | { kind: typeof ArtifactWorkerTask.ReadMcpMarketplace; input: { roots: string[] } }
  | { kind: typeof ArtifactWorkerTask.VerifyModelCatalog; input: VerifyModelCatalogUpdateInput }
  | { kind: typeof ArtifactWorkerTask.FindSkillSourceDirs; input: { source: string } }
  | { kind: typeof ArtifactWorkerTask.ReadPresetCatalog; input: { skillsRoot: string } }
  | {
      kind: typeof ArtifactWorkerTask.ReadPresetMembers;
      input: Parameters<typeof readPresetMemberProfiles>[0];
    }
  | {
      kind: typeof ArtifactWorkerTask.ReadPresetExpert;
      input: { skillsRoot: string; presetId: string; agentId: string };
    }
  | {
      kind: typeof ArtifactWorkerTask.ReadGgufPlacement;
      input: { filePath: string; cacheTypeK?: string; cacheTypeV?: string };
    }
  | { kind: typeof ArtifactWorkerTask.InspectWorkspaceContent; input: { bytes: ArrayBuffer } };
