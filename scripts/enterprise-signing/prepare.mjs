import { appendFileSync } from 'node:fs';

const SOURCE_REPO = 'rongxinzy/zhiyuanAaaS';
const SOURCE_WORKFLOW = '.github/workflows/package-windows.yml';
const SOURCE_JOB = 'package-and-install';
const ARTIFACT_PATTERN = /^zhiyuan-enterprise-windows-(\d+\.\d+\.\d+)-\d+$/;
const REQUIRED_STEPS = [
  'Build enterprise installer',
  'Verify packaged enterprise version',
  'Verify injected enterprise package',
  'Verify packaged runtimes',
  'Upload enterprise installer',
];

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
    throw new Error(
      'RUNTIME_ARTIFACT_READ_TOKEN is required to read Zhiyuan Enterprise provenance.',
    );
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

function resolvePackageVersion(env, artifactVersion) {
  if (env.RELEASE_VERSION) {
    const version = packageVersion(env.RELEASE_VERSION);
    if (version !== artifactVersion) {
      throw new Error(
        `release_version ${version} does not match the unsigned build artifact version ${artifactVersion}.`,
      );
    }
    return version;
  }
  return packageVersion(artifactVersion);
}

export async function prepareEnterpriseSigning(env = process.env) {
  const id = runId(env.SOURCE_RUN_ID);
  const token = env.RUNTIME_ARTIFACT_READ_TOKEN;
  const run = await githubApi(SOURCE_REPO, `actions/runs/${id}`, token);

  if (
    String(run.id) !== id ||
    run.repository?.full_name !== SOURCE_REPO ||
    run.head_repository?.full_name !== SOURCE_REPO ||
    run.path !== SOURCE_WORKFLOW ||
    run.event !== 'workflow_dispatch' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    !/^[0-9a-f]{40}$/.test(run.head_sha ?? '')
  ) {
    throw new Error(
      'Source run is not a successful Zhiyuan Enterprise workflow_dispatch Windows package build.',
    );
  }

  const jobs = await githubApi(SOURCE_REPO, `actions/runs/${id}/jobs?per_page=100`, token);
  const matchingJobs = (jobs.jobs || []).filter(job => job.name === SOURCE_JOB);
  if (matchingJobs.length !== 1) {
    throw new Error('Expected exactly one Zhiyuan Enterprise package-and-install job.');
  }
  const job = matchingJobs[0];
  for (const name of REQUIRED_STEPS) {
    const ok = (job.steps || []).some(step => step.name === name && step.conclusion === 'success');
    if (!ok) throw new Error(`Required Zhiyuan Enterprise build step did not succeed: ${name}`);
  }

  const artifacts = await githubApi(
    SOURCE_REPO,
    `actions/runs/${id}/artifacts?per_page=100`,
    token,
  );
  const windowsArtifacts = (artifacts.artifacts || []).filter(
    artifact => ARTIFACT_PATTERN.test(artifact.name || '') && !artifact.expired,
  );
  if (windowsArtifacts.length !== 1) {
    throw new Error('Expected exactly one unexpired zhiyuan-enterprise-windows artifact.');
  }
  const artifactVersion = windowsArtifacts[0].name.match(ARTIFACT_PATTERN)[1];

  const version = resolvePackageVersion(env, artifactVersion);

  return {
    sourceRepository: SOURCE_REPO,
    sourceRunId: id,
    sourceSha: run.head_sha,
    packageVersion: version,
  };
}

async function main() {
  const result = await prepareEnterpriseSigning();
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `source-repository=${result.sourceRepository}`,
        `source-run-id=${result.sourceRunId}`,
        `source-sha=${result.sourceSha}`,
        `package-version=${result.packageVersion}`,
        '',
      ].join('\n'),
    );
  }
  console.log(
    `Verified Zhiyuan Enterprise source run ${result.sourceRunId} (${result.sourceSha}); ` +
      `will rebuild signed package ${result.packageVersion}.`,
  );
}

if (process.argv[1] && /prepare\.mjs$/.test(process.argv[1].replaceAll('\\', '/'))) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
