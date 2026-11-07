import { PackagingJob } from './constants.ts';
import {
  PREFLIGHT_SOURCE_ARTIFACT_NAME,
  PREFLIGHT_SOURCE_RECORD_FILE,
  RELEASE_CANDIDATE_ATTESTATION_ARTIFACT_NAME,
  RELEASE_CANDIDATE_ATTESTATION_FILE,
  type PreflightSourceRecordV1,
  parsePreflightSourceRecord,
  parseReleaseCandidateAttestation,
} from './release-candidate-attestation.ts';
import {
  assertLatestDailyCiPermitsRelease,
  paginateItemsOrThrow,
  selectLatestWorkflowRun,
  type WorkflowJobSummary,
  type WorkflowRunSummary,
} from './release-candidate.ts';

const RELEASE_PREFLIGHT_WORKFLOW_FILE = 'release-preflight.yml';
const MAX_ATTESTATION_ZIP_BYTES = 256 * 1024;
const MAX_SOURCE_ZIP_BYTES = 16 * 1024;
const MAX_PREFLIGHT_DISPATCH_RUNS_SCANNED = 40;

const terminalIncomplete = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

export type GitHubClient = {
  fetchJson: (url: string) => Promise<Record<string, unknown>>;
  fetchBytes: (url: string, maxBytes: number) => Promise<ArrayBuffer>;
  unzipMember: (zipBytes: ArrayBuffer, memberName: string, maxMemberBytes: number) => string;
};

export type VerifyReleaseCandidateOptions = {
  repository: string;
  sourceCommit: string;
  maxPreflightRuns?: number;
};

type RunArtifactSummary = {
  id: number;
  name: string;
  workflow_run_id?: number;
  expired?: boolean;
};

type SourceRunBinding = {
  run: WorkflowRunSummary;
  sourceRecord: PreflightSourceRecordV1;
};

function repoBase(repository: string): string {
  return `https://api.github.com/repos/${repository}`;
}

function isTrustedDispatchHeadBranch(headBranch: string | undefined): boolean {
  return headBranch === 'main' || (headBranch?.startsWith('release/') ?? false);
}

function assertEligiblePreflightRun(run: WorkflowRunSummary): void {
  if (run.event !== 'workflow_dispatch') throw new Error(`run ${run.id} is not workflow_dispatch`);
  if (!run.path?.endsWith(RELEASE_PREFLIGHT_WORKFLOW_FILE))
    throw new Error(`run ${run.id} wrong path`);
  if (!isTrustedDispatchHeadBranch(run.head_branch))
    throw new Error(`run ${run.id} untrusted branch`);
}

function findArtifact(artifacts: RunArtifactSummary[], name: string): RunArtifactSummary | null {
  return artifacts.find(artifact => artifact.name === name && artifact.expired !== true) ?? null;
}

async function paginateWorkflowRuns(
  client: GitHubClient,
  url: string,
  maxItems: number,
): Promise<WorkflowRunSummary[]> {
  const pages: Array<{ items?: WorkflowRunSummary[] }> = [];
  for (let page = 1; pages.length < 10; page += 1) {
    const payload = await client.fetchJson(`${url}&per_page=100&page=${page}`);
    const items = (payload.workflow_runs ?? []) as WorkflowRunSummary[];
    pages.push({ items });
    if (items.length < 100) break;
  }
  return paginateItemsOrThrow(pages).slice(0, maxItems);
}

async function loadJsonArtifact(
  client: GitHubClient,
  repository: string,
  artifact: RunArtifactSummary,
  memberName: string,
  maxZipBytes: number,
  maxJsonBytes: number,
): Promise<unknown> {
  if (artifact.workflow_run_id == null) {
    throw new Error(`Artifact ${artifact.id} is missing workflow_run_id metadata`);
  }
  const zipBytes = await client.fetchBytes(
    `${repoBase(repository)}/actions/artifacts/${artifact.id}/zip`,
    maxZipBytes,
  );
  const jsonText = client.unzipMember(zipBytes, memberName, maxJsonBytes);
  return JSON.parse(jsonText);
}

function assertRecordMatchesRun(record: PreflightSourceRecordV1, run: WorkflowRunSummary): void {
  const attempt = run.run_attempt ?? 1;
  if (record.workflowRunId !== run.id) throw new Error('source record workflowRunId mismatch');
  if (record.workflowRunAttempt !== attempt)
    throw new Error('source record workflowRunAttempt mismatch');
  if (record.workflowHeadSha !== run.head_sha)
    throw new Error('source record workflowHeadSha mismatch');
  if (record.dispatchRef !== `refs/heads/${run.head_branch}`)
    throw new Error('source record dispatchRef mismatch');
}

function assertAttestationMatchesRun(
  attestation: ReturnType<typeof parseReleaseCandidateAttestation>,
  run: WorkflowRunSummary,
  artifact: RunArtifactSummary,
  sourceRecord: PreflightSourceRecordV1,
): void {
  const attempt = run.run_attempt ?? 1;
  if (artifact.workflow_run_id != null && artifact.workflow_run_id !== run.id) {
    throw new Error('attestation artifact workflow_run_id mismatch');
  }
  if (attestation.workflowRunId !== run.id) throw new Error('attestation workflowRunId mismatch');
  if (attestation.workflowRunAttempt !== attempt)
    throw new Error('attestation workflowRunAttempt mismatch');
  if (attestation.workflowHeadSha !== run.head_sha)
    throw new Error('attestation workflowHeadSha mismatch');
  if (attestation.dispatchRef !== `refs/heads/${run.head_branch}`) {
    throw new Error('attestation dispatchRef mismatch');
  }
  if (attestation.sourceCommit !== sourceRecord.sourceCommit) {
    throw new Error('attestation sourceCommit does not match source record');
  }
}

function assertPreflightJobs(jobs: WorkflowJobSummary[]): void {
  const required = ['preflight-gate', ...Object.values(PackagingJob)];
  for (const name of required) {
    const job = jobs.find(entry => entry.name === name);
    if (!job || job.status !== 'completed' || job.conclusion !== 'success') {
      throw new Error(`Preflight job ${name} must be success, got ${job?.conclusion ?? 'missing'}`);
    }
  }
}

function assertRunPermitsRelease(run: WorkflowRunSummary, sourceCommit: string): void {
  if (terminalIncomplete.has(run.status)) {
    throw new Error(`Preflight run ${run.id} for ${sourceCommit} is still ${run.status}`);
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(`Preflight run ${run.id} concluded ${run.conclusion ?? run.status}`);
  }
}

function assertNoNewerPendingDispatch(
  runs: WorkflowRunSummary[],
  accepted: WorkflowRunSummary,
): void {
  for (const run of runs) {
    if (run.run_number <= accepted.run_number) continue;
    try {
      assertEligiblePreflightRun(run);
    } catch {
      continue;
    }
    if (terminalIncomplete.has(run.status)) {
      throw new Error(
        `Preflight run ${run.id} is newer than accepted run ${accepted.id} and still ${run.status}`,
      );
    }
  }
}

async function verifyDailyCi(
  client: GitHubClient,
  repository: string,
  sourceCommit: string,
): Promise<WorkflowRunSummary> {
  const runs = await paginateWorkflowRuns(
    client,
    `${repoBase(repository)}/actions/workflows/ci.yml/runs?head_sha=${sourceCommit}`,
    100,
  );
  const latest = selectLatestWorkflowRun(runs.filter(run => run.head_sha === sourceCommit));
  if (!latest) throw new Error(`No CI workflow run found for commit ${sourceCommit}`);
  const jobsPayload = await client.fetchJson(
    `${repoBase(repository)}/actions/runs/${latest.id}/jobs?per_page=100`,
  );
  return assertLatestDailyCiPermitsRelease(
    runs,
    (jobsPayload.jobs ?? []) as WorkflowJobSummary[],
    sourceCommit,
  );
}

export async function verifyPreflightAttestationProvenance(
  client: GitHubClient,
  options: VerifyReleaseCandidateOptions,
): Promise<{ run: WorkflowRunSummary; artifactId: number }> {
  const { repository, sourceCommit } = options;
  const maxRuns = options.maxPreflightRuns ?? MAX_PREFLIGHT_DISPATCH_RUNS_SCANNED;
  const dispatchRuns = await paginateWorkflowRuns(
    client,
    `${repoBase(repository)}/actions/workflows/${RELEASE_PREFLIGHT_WORKFLOW_FILE}/runs?event=workflow_dispatch`,
    maxRuns,
  );

  const bindings: SourceRunBinding[] = [];
  for (const run of dispatchRuns) {
    try {
      assertEligiblePreflightRun(run);
    } catch {
      continue;
    }
    const artifactsPayload = await client.fetchJson(
      `${repoBase(repository)}/actions/runs/${run.id}/artifacts?per_page=100`,
    );
    const sourceArtifact = findArtifact(
      (artifactsPayload.artifacts ?? []) as RunArtifactSummary[],
      PREFLIGHT_SOURCE_ARTIFACT_NAME,
    );
    if (!sourceArtifact) continue;
    const record = parsePreflightSourceRecord(
      await loadJsonArtifact(
        client,
        repository,
        sourceArtifact,
        PREFLIGHT_SOURCE_RECORD_FILE,
        MAX_SOURCE_ZIP_BYTES,
        8_192,
      ),
      { repository },
    );
    assertRecordMatchesRun(record, run);
    if (record.sourceCommit !== sourceCommit) continue;
    bindings.push({ run, sourceRecord: record });
  }

  const latest = selectLatestWorkflowRun(bindings.map(binding => binding.run));
  if (!latest) {
    throw new Error(
      `No trusted workflow_dispatch preflight with release-preflight-source artifact for ${sourceCommit}`,
    );
  }
  const binding = bindings.find(entry => entry.run.id === latest.id);
  if (!binding) throw new Error(`Internal error: missing binding for preflight run ${latest.id}`);

  assertNoNewerPendingDispatch(
    dispatchRuns.filter(run => {
      try {
        assertEligiblePreflightRun(run);
        return true;
      } catch {
        return false;
      }
    }),
    latest,
  );
  assertRunPermitsRelease(latest, sourceCommit);
  if (!binding.sourceRecord.includePackaging) {
    throw new Error(`Preflight run ${latest.id} was dispatched with include-packaging=false`);
  }

  const artifactsPayload = await client.fetchJson(
    `${repoBase(repository)}/actions/runs/${latest.id}/artifacts?per_page=100`,
  );
  const attestationArtifact = findArtifact(
    (artifactsPayload.artifacts ?? []) as RunArtifactSummary[],
    RELEASE_CANDIDATE_ATTESTATION_ARTIFACT_NAME,
  );
  if (!attestationArtifact) {
    throw new Error(`Preflight run ${latest.id} is missing release-candidate-attestation`);
  }

  const attestation = parseReleaseCandidateAttestation(
    await loadJsonArtifact(
      client,
      repository,
      attestationArtifact,
      RELEASE_CANDIDATE_ATTESTATION_FILE,
      MAX_ATTESTATION_ZIP_BYTES,
      65_536,
    ),
    { repository, sourceCommit },
  );
  assertAttestationMatchesRun(attestation, latest, attestationArtifact, binding.sourceRecord);

  const jobsPayload = await client.fetchJson(
    `${repoBase(repository)}/actions/runs/${latest.id}/jobs?per_page=100`,
  );
  assertPreflightJobs((jobsPayload.jobs ?? []) as WorkflowJobSummary[]);

  return { run: latest, artifactId: attestationArtifact.id };
}

export async function verifyReleaseCandidateReadiness(
  client: GitHubClient,
  options: VerifyReleaseCandidateOptions,
): Promise<{ ciRunId: number; preflightRunId: number; artifactId: number }> {
  const ciRun = await verifyDailyCi(client, options.repository, options.sourceCommit);
  const preflight = await verifyPreflightAttestationProvenance(client, options);
  return { ciRunId: ciRun.id, preflightRunId: preflight.run.id, artifactId: preflight.artifactId };
}
