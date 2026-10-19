import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { verifyGitHubReleaseRecovery } from './github-release-recovery-lib.mjs';

const tag = process.env.RELEASE_TAG ?? '';
const runId = process.env.CANDIDATE_RUN_ID ?? '';
const repository = process.env.GITHUB_REPOSITORY ?? '';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) || !/^[1-9][0-9]*$/.test(runId)) {
  throw new Error('Invalid repository, release tag, or candidate run ID');
}
const api = endpoint => JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${endpoint}`], {
  encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
}));
const run = api(`actions/runs/${runId}`);
const commit = api(`commits/${encodeURIComponent(tag)}`).sha;
const jobs = [];
for (let page = 1; ; page++) {
  const result = api(`actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`);
  jobs.push(...result.jobs);
  if (jobs.length >= result.total_count) break;
}
const identity = verifyGitHubReleaseRecovery({ tag, runId, commit, run, jobs });
if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(identity).map(([key, value]) => `${key}=${value}\n`).join(''));
console.log(`[GitHubRelease] verified original release ${tag} at ${commit}, run ${runId}`);
