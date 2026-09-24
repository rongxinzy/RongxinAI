import { appendFileSync } from 'node:fs';

const SOURCE_REPO = 'rongxinzy/xiaoruan-ai-agent';
const SOURCE_WORKFLOW = '.github/workflows/build-platforms.yml';
const SOURCE_ARTIFACT = 'windows-build';

function runId(value) {
  if (!/^[1-9]\d{0,19}$/.test(String(value ?? ''))) {
    throw new Error('source_run_id must be a positive Actions run ID.');
  }
  return String(value);
}

function packageVersion(value) {
  const raw = String(value ?? '')
    .trim()
    .replace(/^v/i, '');
  if (
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(
      raw,
    )
  ) {
    throw new Error(`release_version must be SemVer (got: ${value})`);
  }
  return raw;
}

async function githubApi(repo, suffix, token) {
  if (!token) {
    throw new Error('RUNTIME_ARTIFACT_READ_TOKEN is required to read Xiaoruan provenance.');
  }
  const response = await fetch(`https://api.github.com/repos/${repo}/${suffix}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub provenance query failed (${response.status}): ${repo}/${suffix}`);
  }
  return response.json();
}

async function resolvePackageVersion(env, sourceSha, token) {
  if (env.RELEASE_VERSION) return packageVersion(env.RELEASE_VERSION);
  const file = await githubApi(SOURCE_REPO, `contents/package.json?ref=${sourceSha}`, token);
  if (file.encoding !== 'base64' || typeof file.content !== 'string') {
    throw new Error('Unable to read Xiaoruan package.json for the source commit.');
  }
  const pkg = JSON.parse(Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8'));
  return packageVersion(pkg.version);
}

export async function prepareXiaoruanSigning(env = process.env) {
  const id = runId(env.SOURCE_RUN_ID);
  const token = env.RUNTIME_ARTIFACT_READ_TOKEN;
  const run = await githubApi(SOURCE_REPO, `actions/runs/${id}`, token);

  if (
    String(run.id) !== id ||
    run.repository?.full_name !== SOURCE_REPO ||
    run.head_repository?.full_name !== SOURCE_REPO ||
    run.path !== SOURCE_WORKFLOW ||
    run.event !== 'workflow_dispatch' ||
    run.head_branch !== 'main' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    !/^[0-9a-f]{40}$/.test(run.head_sha ?? '')
  ) {
    throw new Error(
      'Source run is not a successful Xiaoruan main workflow_dispatch Windows package build.',
    );
  }

  const jobs = await githubApi(SOURCE_REPO, `actions/runs/${id}/jobs?per_page=100`, token);
  const matchingJobs = (jobs.jobs || []).filter(job =>
    /^build-platforms(?: \(windows,|$)/.test(job.name || ''),
  );
  if (matchingJobs.length !== 1) {
    throw new Error('Expected exactly one Xiaoruan Windows build job.');
  }
  const job = matchingJobs[0];
  for (const name of [
    'Build Windows',
    'Verify Windows package runtimes with a clean PATH',
    'Run actions/upload-artifact@v6',
  ]) {
    const ok = (job.steps || []).some(
      step => step.name === name && step.conclusion === 'success',
    );
    if (!ok) throw new Error(`Required Xiaoruan build step did not succeed: ${name}`);
  }

  const artifacts = await githubApi(
    SOURCE_REPO,
    `actions/runs/${id}/artifacts?per_page=100`,
    token,
  );
  const windowsArtifacts = (artifacts.artifacts || []).filter(
    artifact => artifact.name === SOURCE_ARTIFACT && !artifact.expired,
  );
  if (windowsArtifacts.length !== 1) {
    throw new Error('Expected exactly one unexpired windows-build artifact.');
  }

  const version = await resolvePackageVersion(env, run.head_sha, token);

  return {
    sourceRepository: SOURCE_REPO,
    sourceRunId: id,
    sourceSha: run.head_sha,
    artifact: SOURCE_ARTIFACT,
    artifactId: String(windowsArtifacts[0].id),
    packageVersion: version,
  };
}

async function main() {
  const result = await prepareXiaoruanSigning();
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `source-repository=${result.sourceRepository}`,
        `source-run-id=${result.sourceRunId}`,
        `source-sha=${result.sourceSha}`,
        `artifact=${result.artifact}`,
        `artifact-id=${result.artifactId}`,
        `package-version=${result.packageVersion}`,
        '',
      ].join('\n'),
    );
  }
  console.log(
    `Verified Xiaoruan source run ${result.sourceRunId} (${result.sourceSha}); will rebuild signed package ${result.packageVersion}.`,
  );
}

if (process.argv[1] && /prepare\.mjs$/.test(process.argv[1].replaceAll('\\', '/'))) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
