#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RELEASE_CANDIDATE_ATTESTATION_ARTIFACT_NAME,
  RELEASE_CANDIDATE_ATTESTATION_FILE,
  parseReleaseCandidateAttestation,
} from './release-candidate-attestation.ts';
import {
  assertLatestDailyCiPermitsRelease,
  paginateItemsOrThrow,
  selectLatestWorkflowRun,
  selectNewestValidAttestation,
} from './release-candidate.ts';

const commit = process.env.SOURCE_COMMIT ?? '';
const repository = process.env.GITHUB_REPOSITORY ?? '';
const token = process.env.GITHUB_TOKEN ?? '';

if (!/^[0-9a-f]{40}$/.test(commit)) {
  console.error('[ReleaseCandidate] SOURCE_COMMIT must be a full Git SHA');
  process.exit(1);
}
if (!repository || !token) {
  console.error('[ReleaseCandidate] GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  process.exit(1);
}

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
};

async function fetchJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
  }
  return response.json();
}

async function paginate(urlBuilder, itemKey) {
  const pages = [];
  let page = 1;
  for (;;) {
    const payload = await fetchJson(urlBuilder(page));
    const items = payload[itemKey] ?? [];
    pages.push({ items });
    if (!items.length) break;
    if (payload.total_count != null && page * 100 >= payload.total_count) break;
    if (items.length < 100) break;
    page += 1;
  }
  return paginateItemsOrThrow(pages);
}

function readAttestationJsonFromZip(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'release-candidate-attest-'));
  const zipPath = join(dir, 'attestation.zip');
  try {
    writeFileSync(zipPath, Buffer.from(bytes));
    execFileSync('unzip', ['-o', zipPath, '-d', dir], { stdio: 'pipe' });
    const jsonPath = join(dir, RELEASE_CANDIDATE_ATTESTATION_FILE);
    return JSON.parse(readFileSync(jsonPath, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function downloadArtifactJson(artifactId) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}/zip`,
    { headers, redirect: 'follow' },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Artifact download failed with ${response.status}: ${body}`);
  }
  return readAttestationJsonFromZip(await response.arrayBuffer());
}

async function listCiRuns() {
  return paginate(
    page =>
      `https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${commit}&per_page=100&page=${page}`,
    'workflow_runs',
  );
}

async function listAttestationArtifacts() {
  return paginate(
    page =>
      `https://api.github.com/repos/${repository}/actions/artifacts?name=${RELEASE_CANDIDATE_ATTESTATION_ARTIFACT_NAME}&per_page=100&page=${page}`,
    'artifacts',
  );
}

async function loadAttestationCandidates(artifacts) {
  const active = artifacts.filter(artifact => artifact.expired !== true);
  const parsed = [];
  for (const artifact of active) {
    const body = await downloadArtifactJson(artifact.id);
    parsed.push({
      ...body,
      artifactId: artifact.id,
      createdAt: artifact.created_at,
    });
  }
  return parsed;
}

try {
  const ciRuns = await listCiRuns();
  const latest = selectLatestWorkflowRun(ciRuns.filter(run => run.head_sha === commit));
  if (!latest) {
    throw new Error(`No CI workflow run found for commit ${commit}`);
  }
  const jobsPayload = await fetchJson(
    `https://api.github.com/repos/${repository}/actions/runs/${latest.id}/jobs?per_page=100`,
  );
  const ciRun = assertLatestDailyCiPermitsRelease(ciRuns, jobsPayload.jobs ?? [], commit);

  const artifacts = await listAttestationArtifacts();
  const candidates = await loadAttestationCandidates(artifacts);
  const selected = selectNewestValidAttestation(
    candidates.map(item => ({
      sourceCommit: item.sourceCommit,
      issuedAt: item.issuedAt,
      createdAt: item.createdAt,
      raw: item,
    })),
    commit,
  );
  if (!selected) {
    throw new Error(
      `No release-candidate attestation artifact for commit ${commit}. Run Release preflight (workflow_dispatch) with source-ref set to this SHA and include-packaging=true.`,
    );
  }
  const attestation = parseReleaseCandidateAttestation(selected.raw, {
    repository,
    sourceCommit: commit,
  });

  console.log(
    `[ReleaseCandidate] ci run ${ciRun.id} ci-gate ok; attestation artifact ${selected.raw.artifactId} from preflight run ${attestation.workflowRunId} (dispatch ${attestation.dispatchRef}, workflow head ${attestation.workflowHeadSha}) permits ${commit}`,
  );
} catch (error) {
  console.error('[ReleaseCandidate] readiness verification failed:', error);
  process.exit(1);
}
