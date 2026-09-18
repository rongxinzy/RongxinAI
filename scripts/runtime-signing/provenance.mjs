import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const SigningAuthority = Object.freeze({
  repo: 'rongxinzy/RongxinAI',
  workflow: '.github/workflows/runtime-central-signing.yml',
});
export const RuntimeSources = Object.freeze({
  sidecar: {
    repo: 'rongxinzy/pi-connect',
    workflow: '.github/workflows/zhiyuan-sidecar-release.yml',
    artifact: 'unsigned-sidecar-binaries',
    tag: /^zhiyuan-sidecar-v[0-9][0-9A-Za-z.-]*$/,
    files: ['cc-connect-sidecar-windows-amd64.exe'],
  },
  engram: {
    repo: 'z189yis/engram-cjk',
    workflow: '.github/workflows/fork-release.yml',
    artifact: 'unsigned-engram-binaries',
    tag: /^v\d+\.\d+\.\d+-zhiyuan\.\d+$/,
    files: ['engram-windows-amd64.exe', 'engram-windows-arm64.exe'],
  },
});

export function sourceFor(key) {
  if (!Object.hasOwn(RuntimeSources, key)) throw new Error('Unsupported runtime source.');
  return RuntimeSources[key];
}
export function runId(value) {
  if (!/^[1-9]\d{0,19}$/.test(String(value))) throw new Error('Invalid Actions run ID.');
  return String(value);
}
export function signerThumbprint(value) {
  const normalized = String(value ?? '')
    .replace(/\s/g, '')
    .toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(normalized))
    throw new Error('Expected public runtime signer is not configured.');
  return normalized;
}
export function validateRun(run, repo, workflow, expectedId, event) {
  if (
    String(run.id) !== runId(expectedId) ||
    run.repository?.full_name !== repo ||
    run.head_repository?.full_name !== repo ||
    run.path !== workflow ||
    run.event !== event ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    !/^[0-9a-f]{40}$/.test(run.head_sha ?? '')
  ) {
    throw new Error('Actions run provenance is not a successful trusted workflow execution.');
  }
}
export function assertAncestor(comparison) {
  if (!['ahead', 'identical'].includes(comparison.status)) {
    throw new Error('Source commit is not reachable from main.');
  }
}
export async function githubApi(repo, suffix, token = process.env.RUNTIME_ARTIFACT_READ_TOKEN) {
  if (!token)
    throw new Error('RUNTIME_ARTIFACT_READ_TOKEN is required for cross-repository artifacts.');
  const response = await fetch(`https://api.github.com/repos/${repo}/${suffix}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub provenance query failed (${response.status}).`);
  return response.json();
}
export async function readBuildRun(key, value, api = githubApi) {
  const source = sourceFor(key);
  const id = runId(value);
  const run = await api(source.repo, `actions/runs/${id}`);
  validateRun(run, source.repo, source.workflow, id, 'push');
  if (!source.tag.test(run.head_branch ?? ''))
    throw new Error('Build must originate from a release tag.');
  assertAncestor(await api(source.repo, `compare/${run.head_sha}...main`));
  let ref = (await api(source.repo, `git/ref/tags/${encodeURIComponent(run.head_branch)}`)).object;
  for (let depth = 0; ref?.type === 'tag' && depth < 4; depth++) {
    ref = (await api(source.repo, `git/tags/${ref.sha}`)).object;
  }
  if (ref?.type !== 'commit' || ref.sha !== run.head_sha)
    throw new Error('Release tag no longer matches the build commit.');
  return {
    key,
    sourceRepository: source.repo,
    sourceRunId: id,
    sourceSha: run.head_sha,
    sourceTag: run.head_branch,
  };
}
export async function readSigningRun(value, api = githubApi) {
  const id = runId(value);
  const run = await api(SigningAuthority.repo, `actions/runs/${id}`);
  validateRun(run, SigningAuthority.repo, SigningAuthority.workflow, id, 'workflow_dispatch');
  if (run.head_branch !== 'main') throw new Error('Signing workflow must run on main.');
  assertAncestor(await api(SigningAuthority.repo, `compare/${run.head_sha}...main`));
  return run;
}
export function executableHash(directory, filename) {
  const file = path.join(directory, filename);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 256 * 1024 * 1024) {
    throw new Error('Runtime executable must be a bounded regular file.');
  }
  const bytes = readFileSync(file);
  if (bytes[0] !== 0x4d || bytes[1] !== 0x5a)
    throw new Error('Runtime file is not a Windows executable.');
  return createHash('sha256').update(bytes).digest('hex');
}
export function validateManifest(manifest, build, signingId) {
  const source = sourceFor(build.key);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.signingRepository !== SigningAuthority.repo ||
    manifest.signingRunId !== runId(signingId) ||
    ['key', 'sourceRepository', 'sourceRunId', 'sourceSha', 'sourceTag'].some(
      key => manifest[key] !== build[key],
    ) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== source.files.length
  ) {
    throw new Error('Signed manifest does not match the requested source and signing run.');
  }
  const names = manifest.files.map(file => file.name).sort();
  if (
    JSON.stringify(names) !== JSON.stringify([...source.files].sort()) ||
    manifest.files.some(
      file =>
        !/^[0-9a-f]{64}$/.test(file.unsignedSha256 ?? '') ||
        !/^[0-9a-f]{64}$/.test(file.signedSha256 ?? ''),
    )
  ) {
    throw new Error('Signed manifest executable set or hashes are invalid.');
  }
}
