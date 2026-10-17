/** @typedef {{ bundleId: string; manifestName: string }} ReleaseCandidateBundle */

/** @returns {ReleaseCandidateBundle[]} */
export function listReleaseCandidateBundles() {
  /** @type {ReleaseCandidateBundle[]} */
  const bundles = [];
  for (const edition of ['lite', 'cpu', 'cuda']) {
    bundles.push({
      bundleId: `win32-x64-${edition}`,
      manifestName: `candidate-win32-x64-${edition}.json`,
    });
    bundles.push({
      bundleId: `linux-x64-${edition}`,
      manifestName: `candidate-linux-x64-${edition}.json`,
    });
  }
  for (const arch of ['arm64', 'x64']) {
    for (const edition of ['lite', 'cpu']) {
      bundles.push({
        bundleId: `darwin-${arch}-${edition}`,
        manifestName: `candidate-darwin-${arch}-${edition}.json`,
      });
    }
  }
  return bundles;
}
