import type { collectWorkbenchArtifacts } from './artifactCollector';
import { ArtifactWorkerTask } from './artifactWorkerConstants';

export interface WorkspaceContentInspection {
  sha256: string;
  text: string;
  binary: boolean;
}

export type ArtifactWorkerInput =
  | {
      kind: typeof ArtifactWorkerTask.Collect;
      input: Parameters<typeof collectWorkbenchArtifacts>[0];
    }
  | { kind: typeof ArtifactWorkerTask.InspectWorkspaceContent; input: { bytes: ArrayBuffer } };
