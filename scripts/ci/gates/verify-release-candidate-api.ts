import {
  RELEASE_CANDIDATE_ATTESTATION_FILE,
  parseReleaseCandidateAttestation,
} from './release-candidate-attestation.ts';
import {
  MAX_ATTESTATION_ZIP_BYTES,
  MAX_PREFLIGHT_DISPATCH_RUNS_SCANNED,
  RELEASE_PREFLIGHT_WORKFLOW_FILE,
  assertAttestationMatchesRunProvenance,
  assertEligiblePreflightWorkflowRun,
  assertPreflightInstallJobsSucceeded,
  assertResolvedSourcePreflightRunPermitsRelease,
  findNamedRunArtifact,
  parseSourceJobCommit,
  type RunArtifactSummary,
} from './release-preflight-provenance.ts';
import {
  assertLatestDailyCiPermitsRelease,
  paginateItemsOrThrow,
  selectLatestWorkflowRun,
  type WorkflowJobSummary,
  type WorkflowRunSummary,
} from './release-candidate.ts';

export type GitHubClient = {
  fetchJson: (url: string) => Promise<Record<string, unknown>>;
  fetchBytes: (url: string, maxBytes: number) => Promise<ArrayBuffer>;
  unzipMember: (zipBytes: ArrayBuffer, memberName: string, maxMemberBytes: number) => string;
};

export type VerifyReleaseCandidateOptions = {
  repository: string;
  sourceCommit: string;
  maxPreflightRuns?: number;
  maxZipBytes?: number;
};

function repoBase(repository: string): string {
  return `https://api.github.com/repos/${repository}`;
}

async function paginateWorkflowRuns(
  client: GitHubClient,
  url: string,
  maxItems: number,
): Promise<WorkflowRunSummary[]> {
  const pages: Array<{ items?: WorkflowRunSummary[] }> = [];
  let page = 1;
  let collected: WorkflowRunSummary[] = [];
  for (;;) {
    const payload = await client.fetchJson(`${url}&per_page=100&page=${page}`);
    const items = (payload.workflow_runs ?? []) as WorkflowRunSummary[];
    pages.push({ items });
    collected = paginateItemsOrThrow(pages);
    if (collected.length >= maxItems || items.length < 100) break;
    page += 1;
  }
  return collected.slice(0, maxItems);
}

async function resolveSourceCommitForRun(
  client: GitHubClient,
  repository: string,
  run: WorkflowRunSummary,
  jobs: WorkflowJobSummary[],
): Promise<string | null> {
  const sourceJob = jobs.find(job => job.name === 'source');
  if (!sourceJob) return null;
  const detail = await client.fetchJson(`${repoBase(repository)}/actions/jobs/${sourceJob.id}`);
  return parseSourceJobCommit(detail.outputs as Record<string, unknown> | undefined);
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
  if (!latest) {
    throw new Error(`No CI workflow run found for commit ${sourceCommit}`);
  }
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
  const maxZip = options.maxZipBytes ?? MAX_ATTESTATION_ZIP_BYTES;

  const dispatchRuns = await paginateWorkflowRuns(
    client,
    `${repoBase(repository)}/actions/workflows/${RELEASE_PREFLIGHT_WORKFLOW_FILE}/runs?event=workflow_dispatch`,
    maxRuns,
  );

  const runsForSource: WorkflowRunSummary[] = [];
  for (const run of dispatchRuns) {
    try {
      assertEligiblePreflightWorkflowRun(run);
    } catch {
      continue;
    }
    const jobsPayload = await client.fetchJson(
      `${repoBase(repository)}/actions/runs/${run.id}/jobs?per_page=100`,
    );
    const jobs = (jobsPayload.jobs ?? []) as WorkflowJobSummary[];
    const resolvedCommit = await resolveSourceCommitForRun(client, repository, run, jobs);
    if (resolvedCommit !== sourceCommit) continue;
    runsForSource.push(run);
  }

  const latestForSource = selectLatestWorkflowRun(runsForSource);
  if (!latestForSource) {
    throw new Error(
      `No workflow_dispatch Release preflight run with source job output commit ${sourceCommit} (scanned ${dispatchRuns.length} runs)`,
    );
  }

  assertResolvedSourcePreflightRunPermitsRelease(latestForSource, sourceCommit);

  const artifactsPayload = await client.fetchJson(
    `${repoBase(repository)}/actions/runs/${latestForSource.id}/artifacts?per_page=100`,
  );
  const artifact = findNamedRunArtifact((artifactsPayload.artifacts ?? []) as RunArtifactSummary[]);
  if (!artifact) {
    throw new Error(
      `Latest preflight run ${latestForSource.id} for ${sourceCommit} has no release-candidate-attestation artifact (include-packaging=false runs cannot release)`,
    );
  }

  const zipBytes = await client.fetchBytes(
    `${repoBase(repository)}/actions/artifacts/${artifact.id}/zip`,
    maxZip,
  );
  const jsonText = client.unzipMember(zipBytes, RELEASE_CANDIDATE_ATTESTATION_FILE, 65_536);
  const attestation = parseReleaseCandidateAttestation(JSON.parse(jsonText), {
    repository,
    sourceCommit,
  });

  const jobsPayload = await client.fetchJson(
    `${repoBase(repository)}/actions/runs/${latestForSource.id}/jobs?per_page=100`,
  );
  const jobs = (jobsPayload.jobs ?? []) as WorkflowJobSummary[];
  const resolvedCommit = await resolveSourceCommitForRun(client, repository, latestForSource, jobs);
  if (resolvedCommit !== sourceCommit) {
    throw new Error(
      `Preflight run ${latestForSource.id} source job commit ${resolvedCommit ?? 'missing'} does not match ${sourceCommit}`,
    );
  }
  assertAttestationMatchesRunProvenance(attestation, latestForSource, artifact, resolvedCommit);
  assertPreflightInstallJobsSucceeded(jobs);

  return { run: latestForSource, artifactId: artifact.id };
}

export async function verifyReleaseCandidateReadiness(
  client: GitHubClient,
  options: VerifyReleaseCandidateOptions,
): Promise<{ ciRunId: number; preflightRunId: number; artifactId: number }> {
  const ciRun = await verifyDailyCi(client, options.repository, options.sourceCommit);
  const preflight = await verifyPreflightAttestationProvenance(client, options);
  return {
    ciRunId: ciRun.id,
    preflightRunId: preflight.run.id,
    artifactId: preflight.artifactId,
  };
}
