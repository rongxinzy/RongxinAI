import {
  assertArtifactBoundToRun,
  parseRunArtifacts,
  parseWorkflowJobs,
  parseWorkflowRuns,
  type GitHubArtifact,
  type GitHubWorkflowRun,
} from './github-rest.ts';
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

type SourceRunBinding = {
  run: GitHubWorkflowRun;
  sourceRecord: PreflightSourceRecordV1;
};

function repoBase(repository: string): string {
  return `https://api.github.com/repos/${repository}`;
}

function isTrustedDispatchHeadBranch(headBranch: string | undefined): boolean {
  return headBranch === 'main' || (headBranch?.startsWith('release/') ?? false);
}

function assertEligiblePreflightRun(run: GitHubWorkflowRun): void {
  if (run.event !== 'workflow_dispatch') throw new Error(`run ${run.id} is not workflow_dispatch`);
  if (!run.path?.endsWith(RELEASE_PREFLIGHT_WORKFLOW_FILE))
    throw new Error(`run ${run.id} wrong path`);
  if (!isTrustedDispatchHeadBranch(run.head_branch))
    throw new Error(`run ${run.id} untrusted branch`);
}

function findArtifact(artifacts: GitHubArtifact[], name: string): GitHubArtifact | null {
  return artifacts.find(artifact => artifact.name === name && artifact.expired !== true) ?? null;
}

async function paginateWorkflowRuns(
  client: GitHubClient,
  url: string,
  maxItems: number,
): Promise<GitHubWorkflowRun[]> {
  const pages: Array<{ items?: GitHubWorkflowRun[] }> = [];
  for (let page = 1; pages.length < 10; page += 1) {
    const payload = await client.fetchJson(`${url}&per_page=100&page=${page}`);
    pages.push({ items: parseWorkflowRuns(payload) });
    const items = pages.at(-1)?.items ?? [];
    if (items.length < 100) break;
  }
  return paginateItemsOrThrow(pages).slice(0, maxItems);
}

async function fetchAttemptJobs(
  client: GitHubClient,
  repository: string,
  run: GitHubWorkflowRun,
): Promise<WorkflowJobSummary[]> {
  const attempt = run.run_attempt ?? 1;
  const payload = await client.fetchJson(
    `${repoBase(repository)}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`,
  );
  return parseWorkflowJobs(payload) as WorkflowJobSummary[];
}

async function loadJsonArtifact(
  client: GitHubClient,
  repository: string,
  artifact: GitHubArtifact,
  runId: number,
  memberName: string,
  maxZipBytes: number,
  maxJsonBytes: number,
): Promise<unknown> {
  assertArtifactBoundToRun(artifact, runId);
  const zipBytes = await client.fetchBytes(
    `${repoBase(repository)}/actions/artifacts/${artifact.id}/zip`,
    maxZipBytes,
  );
  const jsonText = client.unzipMember(zipBytes, memberName, maxJsonBytes);
  return JSON.parse(jsonText);
}

function assertRecordMatchesRun(record: PreflightSourceRecordV1, run: GitHubWorkflowRun): void {
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
  run: GitHubWorkflowRun,
  sourceRecord: PreflightSourceRecordV1,
): void {
  const attempt = run.run_attempt ?? 1;
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

function assertDirectPreflightGateJobs(jobs: WorkflowJobSummary[]): void {
  const source = jobs.find(job => job.name === 'source');
  if (!source || source.status !== 'completed' || source.conclusion !== 'success') {
    throw new Error(
      `Preflight job source must be success on latest attempt, got ${source?.conclusion ?? 'missing'}`,
    );
  }
  const gate = jobs.find(job => job.name === 'preflight-gate');
  if (!gate || gate.status !== 'completed' || gate.conclusion !== 'success') {
    throw new Error(
      `Preflight job preflight-gate must be success, got ${gate?.conclusion ?? 'missing'}`,
    );
  }
}

function assertRunPermitsRelease(run: GitHubWorkflowRun, sourceCommit: string): void {
  if (terminalIncomplete.has(run.status)) {
    throw new Error(`Preflight run ${run.id} for ${sourceCommit} is still ${run.status}`);
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(`Preflight run ${run.id} concluded ${run.conclusion ?? run.status}`);
  }
}

function assertNoNewerPendingDispatch(
  runs: GitHubWorkflowRun[],
  accepted: GitHubWorkflowRun,
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
): Promise<GitHubWorkflowRun> {
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
    parseWorkflowJobs(jobsPayload) as WorkflowJobSummary[],
    sourceCommit,
  );
}

export async function verifyPreflightAttestationProvenance(
  client: GitHubClient,
  options: VerifyReleaseCandidateOptions,
): Promise<{ run: GitHubWorkflowRun; artifactId: number }> {
  const { repository, sourceCommit } = options;
  const maxRuns = options.maxPreflightRuns ?? MAX_PREFLIGHT_DISPATCH_RUNS_SCANNED;
  const dispatchRuns = await paginateWorkflowRuns(
    client,
    `${repoBase(repository)}/actions/workflows/${RELEASE_PREFLIGHT_WORKFLOW_FILE}/runs?event=workflow_dispatch`,
    maxRuns,
  );

  const bindings: SourceRunBinding[] = [];
  const unboundRuns: GitHubWorkflowRun[] = [];
  for (const run of dispatchRuns) {
    try {
      assertEligiblePreflightRun(run);
    } catch {
      continue;
    }

    // Read failures cannot prove this run is unrelated to the requested source.
    // Propagate them instead of falling back to an older successful proof.
    const artifactsPayload = await client.fetchJson(
      `${repoBase(repository)}/actions/runs/${run.id}/artifacts?per_page=100`,
    );
    const sourceArtifact = findArtifact(
      parseRunArtifacts(artifactsPayload),
      PREFLIGHT_SOURCE_ARTIFACT_NAME,
    );
    if (!sourceArtifact) {
      unboundRuns.push(run);
      continue;
    }
    const sourceValue = await loadJsonArtifact(
      client,
      repository,
      sourceArtifact,
      run.id,
      PREFLIGHT_SOURCE_RECORD_FILE,
      MAX_SOURCE_ZIP_BYTES,
      8_192,
    );
    let record: PreflightSourceRecordV1;
    try {
      record = parsePreflightSourceRecord(sourceValue, { repository });
      assertRecordMatchesRun(record, run);
    } catch {
      unboundRuns.push(run);
      continue;
    }
    if (record.sourceCommit !== sourceCommit) continue;
    bindings.push({ run, sourceRecord: record });
  }

  const latest = selectLatestWorkflowRun(bindings.map(binding => binding.run));
  if (!latest) {
    throw new Error(
      `No trusted workflow_dispatch preflight with release-preflight-source artifact for ${sourceCommit}`,
    );
  }
  for (const run of unboundRuns) {
    if (run.run_number > latest.run_number) {
      throw new Error(
        `Preflight run ${run.id} is newer than accepted run ${latest.id} and its source cannot be verified`,
      );
    }
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
    parseRunArtifacts(artifactsPayload),
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
      latest.id,
      RELEASE_CANDIDATE_ATTESTATION_FILE,
      MAX_ATTESTATION_ZIP_BYTES,
      65_536,
    ),
    { repository, sourceCommit },
  );
  assertAttestationMatchesRun(attestation, latest, binding.sourceRecord);

  const jobs = await fetchAttemptJobs(client, repository, latest);
  assertDirectPreflightGateJobs(jobs);

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
