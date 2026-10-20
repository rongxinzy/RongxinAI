import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { listReleaseCandidateBundles } from './release-candidate-layout.mjs';
import { verifyCandidateManifests } from './release-candidate-manifest.mjs';

const [releaseVersion, sourceCommit, candidateRunId, candidateRoot = 'candidate', destination = 'release-assets'] = process.argv.slice(2);
if (!releaseVersion || !sourceCommit || !candidateRunId) {
  throw new Error('usage: collect-github-release-assets.mjs <version> <commit> <run-id> [candidate-root] [destination]');
}

const bundles = listReleaseCandidateBundles();
const payloadRoots = bundles.map(({ bundleId }) => path.resolve(candidateRoot, bundleId));
const manifests = await Promise.all(bundles.map(async ({ manifestName }, index) =>
  JSON.parse(await fs.readFile(path.join(payloadRoots[index], manifestName), 'utf8')),
));
await verifyCandidateManifests({ releaseVersion, sourceCommit, candidateRunId, manifests, payloadRoots });

// Target names preserve every edition when electron-builder uses the same
// updater filename. Copy only manifest-listed installers/updaters, never logs.
const assets = new Map();
for (const [index, manifest] of manifests.entries()) {
  for (const artifact of manifest.artifacts) {
    if (!['installer', 'updater'].includes(artifact.kind)) continue;
    const name = `${artifact.platform}-${artifact.arch}-${artifact.variant}-${artifact.filename}`;
    const source = path.join(payloadRoots[index], artifact.relativePath);
    if (assets.has(name) && assets.get(name) !== source) {
      throw new Error(`Conflicting GitHub release asset: ${name}`);
    }
    assets.set(name, source);
  }
}
await fs.mkdir(destination, { recursive: true });
if ((await fs.readdir(destination)).length !== 0) {
  throw new Error('GitHub release asset destination must be empty');
}
for (const [name, source] of assets) {
  await fs.copyFile(source, path.join(destination, name), constants.COPYFILE_EXCL);
  console.log(`[GitHubRelease] staged ${name}`);
}
