import { PackagingJob } from './constants.ts';
import {
  RELEASE_CANDIDATE_ATTESTATION_ARTIFACT_NAME,
  type ReleaseCandidateAttestationV1,
} from './release-candidate-attestation.ts';
import {
  selectLatestWorkflowRun,
  type WorkflowJobSummary,
  type WorkflowRunSummary,
} from './release-candidate.ts';

export const RELEASE_PREFLIGHT_WORKFLOW_FILE = 'release-preflight.yml';
export const MAX_ATTESTATION_ZIP_BYTES = 256 * 1024;
export const MAX_PREFLIGHT_DISPATCH_RUNS_SCANNED = 40;

const terminalIncomplete = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const shaPattern = /^[0-9a-f]{40}$/;

export type RunArtifactSummary = {
  id: number;
  name: string;
  workflow_run_id?: number;
  expired?: boolean;
  size_in_bytes?: number;
};

function isTrustedDispatchHeadBranch(headBranch: string | undefined): boolean {
  if (!headBranch) return false;
  return headBranch === 'main' || headBranch.startsWith('release/');
}

export function assertEligiblePreflightWorkflowRun(run: WorkflowRunSummary): void {
  if (run.event !== 'workflow_dispatch') {
    throw new Error(
      `Preflight run ${run.id} event must be workflow_dispatch, got ${run.event ?? 'unknown'}`,
    );
  }
  if (!run.path?.endsWith(RELEASE_PREFLIGHT_WORKFLOW_FILE)) {
    throw new Error(
      `Preflight run ${run.id} path must be ${RELEASE_PREFLIGHT_WORKFLOW_FILE}, got ${run.path ?? 'unknown'}`,
    );
  }
  if (!isTrustedDispatchHeadBranch(run.head_branch)) {
    throw new Error(
      `Preflight run ${run.id} head_branch ${run.head_branch ?? 'unknown'} is not an allowed dispatch branch`,
    );
  }
}

export function parseSourceJobCommit(outputs: Record<string, unknown> | undefined): string | null {
  const commit = outputs?.commit;
  return typeof commit === 'string' && shaPattern.test(commit) ? commit : null;
}

export function findNamedRunArtifact(
  artifacts: RunArtifactSummary[],
  name: string = RELEASE_CANDIDATE_ATTESTATION_ARTIFACT_NAME,
): RunArtifactSummary | null {
  const match = artifacts.find(artifact => artifact.name === name && artifact.expired !== true);
  return match ?? null;
}

export function assertAttestationMatchesRunProvenance(
  attestation: ReleaseCandidateAttestationV1,
  run: WorkflowRunSummary,
  artifact: RunArtifactSummary,
  resolvedSourceCommit: string,
): void {
  const attempt = run.run_attempt ?? 1;
  if (artifact.workflow_run_id != null && artifact.workflow_run_id !== run.id) {
    throw new Error(
      `Artifact ${artifact.id} workflow_run_id ${artifact.workflow_run_id} does not match run ${run.id}`,
    );
  }
  if (attestation.workflowRunId !== run.id) {
    throw new Error(
      `Attestation workflowRunId ${attestation.workflowRunId} does not match run ${run.id}`,
    );
  }
  if (attestation.workflowRunAttempt !== attempt) {
    throw new Error(
      `Attestation workflowRunAttempt ${attestation.workflowRunAttempt} does not match run attempt ${attempt}`,
    );
  }
  if (attestation.workflowHeadSha !== run.head_sha) {
    throw new Error('Attestation workflowHeadSha does not match workflow run head_sha');
  }
  const expectedDispatchRef = `refs/heads/${run.head_branch}`;
  if (attestation.dispatchRef !== expectedDispatchRef) {
    throw new Error(
      `Attestation dispatchRef ${attestation.dispatchRef} does not match run head_branch ${run.head_branch}`,
    );
  }
  if (attestation.sourceCommit !== resolvedSourceCommit) {
    throw new Error('Attestation sourceCommit does not match source job output commit');
  }
}

export function assertPreflightInstallJobsSucceeded(jobs: WorkflowJobSummary[]): void {
  const gate = jobs.find(job => job.name === 'preflight-gate');
  if (!gate || gate.status !== 'completed' || gate.conclusion !== 'success') {
    throw new Error(`preflight-gate must be success, got ${gate?.conclusion ?? 'missing'}`);
  }
  for (const name of Object.values(PackagingJob)) {
    const job = jobs.find(entry => entry.name === name);
    if (!job || job.status !== 'completed' || job.conclusion !== 'success') {
      throw new Error(
        `Preflight packaging job ${name} must be success, got ${job?.conclusion ?? 'missing'}`,
      );
    }
  }
}

export function assertResolvedSourcePreflightRunPermitsRelease(
  run: WorkflowRunSummary,
  sourceCommit: string,
): void {
  if (terminalIncomplete.has(run.status)) {
    throw new Error(
      `Latest Release preflight for ${sourceCommit} (run ${run.id}) is ${run.status}; wait for completion.`,
    );
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(
      `Latest Release preflight for ${sourceCommit} (run ${run.id}) concluded ${run.conclusion ?? run.status}; an older attestation cannot release.`,
    );
  }
}
