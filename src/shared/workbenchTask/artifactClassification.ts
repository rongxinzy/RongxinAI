import { CoworkArtifactRole } from '../cowork/artifacts';
import { WorkbenchArtifactCandidateSource, WorkbenchArtifactKind } from './constants';
import type { WorkbenchArtifact } from './types';

export function isWorkbenchDeliverable(artifact: WorkbenchArtifact): boolean {
  if (artifact.metadata.role === CoworkArtifactRole.Intermediate) return false;
  if (artifact.kind === WorkbenchArtifactKind.MessageBlock) {
    // An inline reply block only counts as delivery when it was declared as one
    // (explicit artifact fence) and marked with the deliverable role.
    return (
      artifact.metadata.explicit === true &&
      artifact.metadata.role === CoworkArtifactRole.Deliverable
    );
  }
  return (
    artifact.kind === WorkbenchArtifactKind.File &&
    (artifact.metadata.source === WorkbenchArtifactCandidateSource.DomainWorkflow ||
      (artifact.metadata.source === WorkbenchArtifactCandidateSource.Declaration &&
        artifact.metadata.role === CoworkArtifactRole.Deliverable))
  );
}
