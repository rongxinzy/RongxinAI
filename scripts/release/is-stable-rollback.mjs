import fs from 'node:fs';

import {
  collectionVersion,
  compareVersions,
  loadTrustedReleaseKey,
  readAndVerifyCollection,
} from './update-manifest-lib.mjs';

const [currentPath, candidatePath] = process.argv.slice(2);
if (!currentPath || !candidatePath) {
  throw new Error(
    'usage: is-stable-rollback.mjs <current-collection.json> <candidate-collection.json>',
  );
}
if (currentPath === '-' || !fs.existsSync(currentPath)) {
  process.exit(1);
}

const trustedKey = loadTrustedReleaseKey();
const currentVersion = collectionVersion(await readAndVerifyCollection(currentPath, trustedKey));
const candidateVersion = collectionVersion(await readAndVerifyCollection(candidatePath, trustedKey));
if (compareVersions(candidateVersion, currentVersion) < 0) {
  process.exit(0);
}
process.exit(1);
