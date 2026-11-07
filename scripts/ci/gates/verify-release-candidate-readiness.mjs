#!/usr/bin/env node
import { findSuccessfulCheck, findSuccessfulWorkflowRun } from './release-candidate.ts';

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

async function listCheckRuns(sha) {
  const runs = [];
  let page = 1;
  for (;;) {
    const payload = await fetchJson(
      `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?per_page=100&page=${page}`,
    );
    runs.push(...(payload.check_runs ?? []));
    if (!payload.check_runs?.length || runs.length >= payload.total_count) break;
    page += 1;
  }
  return runs;
}

async function listPreflightRuns(sha) {
  const payload = await fetchJson(
    `https://api.github.com/repos/${repository}/actions/workflows/release-preflight.yml/runs?head_sha=${sha}&status=completed&per_page=30`,
  );
  return payload.workflow_runs ?? [];
}

try {
  const checkRuns = await listCheckRuns(commit);
  const ciGate = findSuccessfulCheck(checkRuns, 'ci-gate');
  if (!ciGate) {
    console.error(
      `[ReleaseCandidate] Commit ${commit} has no successful ci-gate check. Merge only after daily CI is green, or re-run CI on that commit.`,
    );
    process.exit(1);
  }

  const preflightRuns = await listPreflightRuns(commit);
  const preflight = findSuccessfulWorkflowRun(preflightRuns, commit);
  if (!preflight) {
    console.error(
      `[ReleaseCandidate] Commit ${commit} has no successful Release preflight workflow run. Run release-preflight.yml (workflow_dispatch) against this exact SHA before tagging.`,
    );
    process.exit(1);
  }

  console.log(
    `[ReleaseCandidate] ci-gate ${ciGate.html_url ?? 'ok'}; Release preflight run ${preflight.id ?? 'ok'} permits release for ${commit}`,
  );
} catch (error) {
  console.error('[ReleaseCandidate] readiness verification failed:', error);
  process.exit(1);
}
