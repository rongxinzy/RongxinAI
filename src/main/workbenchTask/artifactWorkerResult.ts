import { realpath } from 'node:fs';
import path from 'node:path';
import { CoworkArtifactRole } from '../../shared/cowork/artifacts';
import {
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
} from '../../shared/workbenchTask';
import type { collectWorkbenchArtifacts } from './artifactCollector';

type Input = Parameters<typeof collectWorkbenchArtifacts>[0];
type Artifact = ReturnType<typeof collectWorkbenchArtifacts>[number];

/** Resolve declared paths asynchronously on main, independently of worker output.
 * Hashing and file inspection remain in the worker. Missing paths are left to
 * the collector so callers receive its specific missing-file error. */
export async function resolveDeclaredDeliverablePaths(input: Input): Promise<string[]> {
  const declarations = (input.artifactCandidates ?? []).filter(
    candidate =>
      candidate.source === WorkbenchArtifactCandidateSource.Declaration &&
      candidate.role === CoworkArtifactRole.Deliverable &&
      path.isAbsolute(candidate.path),
  );
  const resolved = await Promise.all(
    declarations.map(
      candidate =>
        new Promise<string | null>(resolve => {
          // Match the collector's fs.realpathSync semantics. The native
          // promise variant expands Windows short names differently.
          realpath(candidate.path, (error, resolvedPath) => resolve(error ? null : resolvedPath));
        }),
    ),
  );
  return resolved.filter((reference): reference is string => reference !== null);
}

export function isValidArtifactWorkerResult(
  artifact: Artifact,
  input: Input,
  declaredDeliverablePaths: readonly string[],
): boolean {
  if (
    artifact.taskId !== input.taskId ||
    artifact.runId !== input.runId ||
    !/^[a-f0-9]{64}$/.test(artifact.contentHash) ||
    typeof artifact.reference !== 'string' ||
    !artifact.reference
  ) {
    return false;
  }
  if (path.isAbsolute(artifact.reference)) {
    return (
      artifact.kind === WorkbenchArtifactKind.File &&
      artifact.provenance === WorkbenchArtifactProvenance.External &&
      artifact.metadata.source === WorkbenchArtifactCandidateSource.Declaration &&
      artifact.metadata.role === CoworkArtifactRole.Deliverable &&
      artifact.metadata.outsideWorkspace === true &&
      declaredDeliverablePaths.some(
        reference => path.relative(reference, artifact.reference) === '',
      )
    );
  }
  return (
    artifact.provenance !== WorkbenchArtifactProvenance.External &&
    artifact.metadata.outsideWorkspace !== true &&
    path.normalize(artifact.reference).split(/[/\\]/)[0] !== '..'
  );
}
