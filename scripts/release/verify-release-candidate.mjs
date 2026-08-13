import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyCandidateManifests } from './release-candidate-manifest.mjs';

const args = process.argv.slice(2);
const payloadFlag = args.indexOf('--payload-roots');
const manifestPaths = payloadFlag === -1 ? args.slice(3) : args.slice(3, payloadFlag);
const payloadRoots = payloadFlag === -1 ? [] : args.slice(payloadFlag + 1);
const [releaseVersion, sourceCommit, candidateRunId] = args;
if (!releaseVersion || !sourceCommit || !candidateRunId || manifestPaths.length === 0) {
  throw new Error(
    'usage: verify-release-candidate.mjs <version> <commit> <run-id> <manifest.json>... [--payload-roots <directory>...]',
  );
}

const manifests = await Promise.all(
  manifestPaths.map(async manifestPath => JSON.parse(await fs.readFile(manifestPath, 'utf8'))),
);
await verifyCandidateManifests({
  releaseVersion,
  sourceCommit,
  candidateRunId,
  manifests,
  payloadRoots: payloadRoots.map(root => path.resolve(root)),
});
console.log(
  `[ReleaseCandidate] verified ${manifests.length} manifests for v${releaseVersion} from ${sourceCommit}`,
);
