import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { WINDOWS_INFERENCE_VARIANTS } from './inference-edition-targets.mjs';
import { verifyCandidateManifests } from './release-candidate-manifest.mjs';

export function assertWindowsDownloads(release, manifests, version) {
  assert.equal(release.tag_name, `v${version}`, 'GitHub release version mismatch');
  assert.equal(release.draft, false, 'GitHub release is still a draft');
  const installers = manifests
    .flatMap(manifest => manifest.artifacts)
    .filter(artifact => artifact.platform === 'win32' && artifact.kind === 'installer');
  assert.equal(
    installers.length,
    WINDOWS_INFERENCE_VARIANTS.length,
    'Missing Windows installer editions',
  );
  assert.deepEqual(
    installers.map(artifact => artifact.variant).sort(),
    [...WINDOWS_INFERENCE_VARIANTS].sort(),
    'Windows installer editions must be complete and unique',
  );
  const downloads = release.assets.filter(asset => asset.name.toLowerCase().endsWith('.exe'));
  assert.equal(
    downloads.length,
    installers.length,
    'Public download page must contain exactly three Windows WebView2 installers',
  );
  for (const artifact of installers) {
    assert.equal(
      artifact.filename,
      `ZhiYuanAgent-Setup-${version}.exe`,
      'Unexpected manual installer filename',
    );
    const name = `win32-${artifact.arch}-${artifact.variant}-${artifact.filename}`;
    const asset = downloads.find(download => download.name === name);
    assert(asset, `Missing public WebView2 installer: ${name}`);
    assert.equal(asset.state, 'uploaded', `Incomplete GitHub upload: ${name}`);
    assert.equal(asset.size, artifact.size, `Public installer size mismatch: ${name}`);
    assert.equal(
      asset.digest,
      `sha256:${artifact.sha256}`,
      `Public installer digest mismatch: ${name}`,
    );
  }
}

async function main() {
  const [version, commit, runId, candidateRoot = 'candidate'] = process.argv.slice(2);
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  assert(repository && token, 'GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const manifests = await Promise.all(
    WINDOWS_INFERENCE_VARIANTS.map(async variant => {
      const target = `win32-x64-${variant}`;
      return JSON.parse(
        await fs.readFile(path.join(candidateRoot, target, `candidate-${target}.json`), 'utf8'),
      );
    }),
  );
  await verifyCandidateManifests({
    releaseVersion: version,
    sourceCommit: commit,
    candidateRunId: runId,
    manifests,
    requireComplete: false,
  });
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(`v${version}`)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  assert(response.ok, `GitHub release inspection returned HTTP ${response.status}`);
  assertWindowsDownloads(await response.json(), manifests, version);
  console.log(
    '[GitHubRelease] public Windows downloads match the three verified WebView2 installers',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
