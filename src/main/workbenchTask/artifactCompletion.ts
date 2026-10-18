import path from 'path';

import type { CoworkPersistedArtifact } from '../../shared/cowork/artifacts';
import {
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactVerificationStatus,
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

const comparablePath = (reference: string, workspaceRoot: string): string =>
  path.resolve(workspaceRoot, reference);

/**
 * The run's file effects, read from the event-time artifact ledger: every
 * file the run wrote, edited or generated (settle-time workspace diff). Files
 * already declared for this run are left to their declaration candidate,
 * which carries the declared role and content hash.
 */
export function getLedgerRunCandidates(
  rows: readonly CoworkPersistedArtifact[],
  runId: string,
  workspaceRoot: string,
  declared: readonly WorkbenchArtifactCandidate[],
): WorkbenchArtifactCandidate[] {
  const declaredPaths = new Set(
    declared.map(candidate => comparablePath(candidate.path, workspaceRoot)),
  );
  const seen = new Set<string>();
  const candidates: WorkbenchArtifactCandidate[] = [];
  for (const row of rows) {
    if (row.runId !== runId || !row.filePath) continue;
    const key = comparablePath(row.filePath, workspaceRoot);
    if (declaredPaths.has(key) || seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      path: row.filePath,
      source: WorkbenchArtifactCandidateSource.ToolEffect,
      verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
    });
  }
  return candidates;
}
