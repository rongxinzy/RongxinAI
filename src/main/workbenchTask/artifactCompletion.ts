import {
  WorkbenchArtifactCandidateSource,
  type WorkbenchArtifact,
  type WorkbenchArtifactCandidate,
} from '../../shared/workbenchTask';

export function getCurrentDeclaredArtifacts(
  artifacts: WorkbenchArtifact[],
  runId: string,
): WorkbenchArtifactCandidate[] {
  const current = new Map<string, WorkbenchArtifact>();
  for (const artifact of artifacts) {
    if (
      artifact.runId !== runId ||
      artifact.metadata.source !== WorkbenchArtifactCandidateSource.Declaration
    )
      continue;
    const previous = current.get(artifact.reference);
    if (!previous || artifact.updatedAt >= previous.updatedAt)
      current.set(artifact.reference, artifact);
  }
  return [...current.values()].map(artifact => ({
    path: artifact.reference,
    source: WorkbenchArtifactCandidateSource.Declaration,
    role: typeof artifact.metadata.role === 'string' ? artifact.metadata.role : undefined,
    sha256: artifact.contentHash,
    verificationStatus: artifact.verificationStatus,
  }));
}
