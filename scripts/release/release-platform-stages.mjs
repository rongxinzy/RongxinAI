/** @typedef {'win32' | 'darwin' | 'linux'} ReleasePlatform */

/** Permanent platform rollout order: Windows, then macOS, then Linux. */
export const RELEASE_PLATFORM_STAGES = /** @type {const} */ (['win32', 'darwin', 'linux']);

/** @type {ReleasePlatform[]} */
export const RELEASE_PLATFORMS = [...RELEASE_PLATFORM_STAGES];

/**
 * Resolve which platforms a release job publishes.
 * @param {NodeJS.ProcessEnv} env
 * @returns {Set<ReleasePlatform>}
 */
export function resolveReleasePlatforms(env = process.env) {
  const stage = (env.ZHIYUAN_RELEASE_PLATFORM ?? '').trim();
  if (!stage) return new Set(RELEASE_PLATFORMS);
  if (!RELEASE_PLATFORMS.includes(/** @type {ReleasePlatform} */ (stage))) {
    throw new Error(`Unsupported ZHIYUAN_RELEASE_PLATFORM: ${stage}`);
  }
  return new Set([/** @type {ReleasePlatform} */ (stage)]);
}

/**
 * @param {Iterable<ReleasePlatform>} platforms
 * @returns {ReleasePlatform[]}
 */
export function sortReleasePlatforms(platforms) {
  const selected = new Set(platforms);
  return RELEASE_PLATFORM_STAGES.filter(platform => selected.has(platform));
}
