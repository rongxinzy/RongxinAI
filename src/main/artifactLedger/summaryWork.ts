import path from 'path';

import { normalizeArtifactKeyPath } from './artifactLedger';

/** Host bookkeeping stays in the ledger, but does not invalidate a checkpoint.
 * Match the reserved state files only: user output in these directories and
 * ordinary files named state.json still count as work. No filesystem reads. */
export function isInternalWorkflowStatePath(filePath: string, workspaceRoot: string): boolean {
  const relativePath = normalizeArtifactKeyPath(path.relative(workspaceRoot, filePath));
  return /^\.zhiyuan\/(?:shortcut-workflows\/[^/]+\/state\.json|research\/[^/]+\/(?:research-state\.json|state\/progress\.json))$/.test(
    relativePath,
  );
}
