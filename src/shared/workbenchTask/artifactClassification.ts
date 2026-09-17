import { CoworkArtifactRole } from '../cowork/artifacts';
import {
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactKind,
  WorkbenchOutputMode,
} from './constants';
import type { WorkbenchArtifact, WorkbenchTaskContract, WorkbenchOutputRequirement } from './types';

export function isWorkbenchDeliverable(
  artifact: WorkbenchArtifact,
  contract?: WorkbenchTaskContract,
): boolean {
  if (artifact.metadata.role === CoworkArtifactRole.Intermediate) return false;
  if (artifact.kind === WorkbenchArtifactKind.MessageBlock) {
    return (
      artifact.metadata.explicit === true &&
      contract?.outputRequirements?.some(
        requirement =>
          requirement.mode === WorkbenchOutputMode.Inline &&
          matchesOutputRequirement(artifact, requirement),
      ) === true
    );
  }
  return (
    artifact.kind === WorkbenchArtifactKind.File &&
    (artifact.metadata.source === WorkbenchArtifactCandidateSource.DomainWorkflow ||
      artifact.metadata.source === WorkbenchArtifactCandidateSource.ProductionInspection ||
      (artifact.metadata.source === WorkbenchArtifactCandidateSource.Declaration &&
        artifact.metadata.role === CoworkArtifactRole.Deliverable))
  );
}

export function matchesOutputRequirement(
  artifact: WorkbenchArtifact,
  requirement: WorkbenchOutputRequirement,
): boolean {
  if (requirement.mode === WorkbenchOutputMode.Text) return false;
  if (requirement.mode === WorkbenchOutputMode.File && artifact.kind !== WorkbenchArtifactKind.File)
    return false;
  if (
    requirement.mode === WorkbenchOutputMode.Inline &&
    artifact.kind !== WorkbenchArtifactKind.MessageBlock
  )
    return false;
  const format =
    artifact.kind === WorkbenchArtifactKind.File
      ? artifact.reference
          .split(/[/\\]/)
          .pop()
          ?.match(/\.([^.]+)$/)?.[1]
          ?.toLowerCase()
      : artifact.metadata.language;
  return requirement.formats.length === 0 || requirement.formats.includes(String(format));
}
