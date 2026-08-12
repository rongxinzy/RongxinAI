import fs from 'node:fs';

import {
  artifactIdentity,
  collectionVersion,
  compareVersions,
  loadTrustedReleaseKey,
  readAndVerifyCollection,
  writeActionOutput,
} from './update-manifest-lib.mjs';

const [currentPath, candidatePath, expectedVersion] = process.argv.slice(2);
if (!currentPath || !candidatePath || !expectedVersion) {
  throw new Error(
    'usage: verify-update-transition.mjs <current-or-dash> <candidate> <expected-version>',
  );
}

const trustedKey = loadTrustedReleaseKey();
const candidateEntries = await readAndVerifyCollection(candidatePath, trustedKey);
const candidateVersion = collectionVersion(candidateEntries);
if (candidateVersion !== expectedVersion) {
  throw new Error(
    `Candidate manifest version ${candidateVersion} does not match ${expectedVersion}`,
  );
}

const candidateArtifacts = new Map(
  candidateEntries.map(entry => {
    const identity = artifactIdentity(entry.payload);
    return [identity.target, identity.value];
  }),
);
if (candidateArtifacts.size !== candidateEntries.length) {
  throw new Error('Candidate manifest contains duplicate platform targets');
}

let idempotent = false;
if (currentPath !== '-') {
  if (!fs.existsSync(currentPath)) throw new Error(`Current manifest not found: ${currentPath}`);
  const currentEntries = await readAndVerifyCollection(currentPath, trustedKey);
  const currentVersion = collectionVersion(currentEntries);
  const ordering = compareVersions(candidateVersion, currentVersion);
  if (ordering < 0) {
    throw new Error(
      `Refusing to replace newer stable version ${currentVersion} with ${candidateVersion}`,
    );
  }
  if (ordering === 0) {
    const currentArtifacts = new Map(
      currentEntries.map(entry => {
        const identity = artifactIdentity(entry.payload);
        return [identity.target, identity.value];
      }),
    );
    if (
      currentArtifacts.size !== candidateArtifacts.size ||
      [...candidateArtifacts].some(
        ([target, identity]) => currentArtifacts.get(target) !== identity,
      )
    ) {
      throw new Error(
        `Stable version ${candidateVersion} already exists with different artifacts`,
      );
    }
    idempotent = true;
  }
}

await writeActionOutput('idempotent', String(idempotent));
console.log(
  idempotent
    ? `[UpdateRelease] ${candidateVersion} is already published with identical artifacts`
    : `[UpdateRelease] ${candidateVersion} passed the monotonic version check`,
);
