import type { TextWorkerInput } from './textWorkerOperations';
import { ArtifactWorkerTask } from './artifactWorkerConstants';
import type { CompanionImageSource } from '../../shared/companion/images';

export interface WorkspaceContentInspection {
  sha256: string;
  text: string;
  binary: boolean;
}

export type ArtifactWorkerInput =
  | { kind: typeof ArtifactWorkerTask.TransformText; input: TextWorkerInput }
  | {
      kind: typeof ArtifactWorkerTask.PrepareCompanionImages;
      input: { sources: CompanionImageSource[] };
    }
  | { kind: typeof ArtifactWorkerTask.InspectWorkspaceContent; input: { bytes: ArrayBuffer } };
