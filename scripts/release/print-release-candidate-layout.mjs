import { listReleaseCandidateBundles } from './release-candidate-layout.mjs';

for (const { bundleId, manifestName } of listReleaseCandidateBundles()) {
  process.stdout.write(`${bundleId}\t${manifestName}\n`);
}
