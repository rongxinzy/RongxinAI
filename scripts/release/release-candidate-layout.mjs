import {
  LINUX_INFERENCE_VARIANTS,
  MACOS_INFERENCE_VARIANTS,
  WINDOWS_INFERENCE_VARIANTS,
} from './inference-edition-targets.mjs';

/** @typedef {{ bundleId: string; manifestName: string }} ReleaseCandidateBundle */

/** @returns {ReleaseCandidateBundle[]} */
export function listReleaseCandidateBundles() {
  /** @type {ReleaseCandidateBundle[]} */
  const bundles = [];
  // lite is Windows-only; Linux ships cpu + cuda; macOS ships cpu per arch.
  for (const edition of WINDOWS_INFERENCE_VARIANTS) {
    bundles.push({
      bundleId: `win32-x64-${edition}`,
      manifestName: `candidate-win32-x64-${edition}.json`,
    });
  }
  for (const edition of LINUX_INFERENCE_VARIANTS) {
    bundles.push({
      bundleId: `linux-x64-${edition}`,
      manifestName: `candidate-linux-x64-${edition}.json`,
    });
  }
  for (const arch of ['arm64', 'x64']) {
    for (const edition of MACOS_INFERENCE_VARIANTS) {
      bundles.push({
        bundleId: `darwin-${arch}-${edition}`,
        manifestName: `candidate-darwin-${arch}-${edition}.json`,
      });
    }
  }
  return bundles;
}
