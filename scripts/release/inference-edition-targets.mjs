import { RELEASE_PLATFORMS, resolveReleasePlatforms } from './release-platform-stages.mjs';

export { RELEASE_PLATFORMS, resolveReleasePlatforms };

/** @typedef {'lite' | 'cpu' | 'cuda'} InferenceEditionVariant */

/** @type {InferenceEditionVariant[]} */
export const WINDOWS_INFERENCE_VARIANTS = ['lite', 'cpu', 'cuda'];

// Edition matrix (krli, 2026-10-17): lite is Windows-only. macOS ships only cpu
// (Metal) per arch; Linux ships cpu + cuda; Windows ships lite + cpu + cuda.
/** @type {InferenceEditionVariant[]} */
export const LINUX_INFERENCE_VARIANTS = ['cpu', 'cuda'];

/** @type {InferenceEditionVariant[]} */
export const MACOS_INFERENCE_VARIANTS = ['cpu'];

/**
 * Stable release targets for signed update manifests.
 * Linux ships deb + AppImage per inference edition (cpu, cuda); macOS ships
 * cpu per arch; Windows ships lite, cpu and cuda.
 */
export function listRequiredReleaseTargets(platforms = resolveReleasePlatforms()) {
  /** @type {string[]} */
  const targets = [];
  for (const variant of WINDOWS_INFERENCE_VARIANTS) {
    targets.push(`win32:x64:${variant}`);
  }
  for (const edition of LINUX_INFERENCE_VARIANTS) {
    targets.push(`linux:x64:deb-${edition}`);
    targets.push(`linux:x64:appimage-${edition}`);
  }
  for (const arch of ['x64', 'arm64']) {
    for (const edition of MACOS_INFERENCE_VARIANTS) {
      targets.push(`darwin:${arch}:${edition}`);
    }
  }
  return targets.filter(target => platforms.has(target.split(':')[0]));
}

export const REQUIRED_RELEASE_TARGETS = new Set(listRequiredReleaseTargets());

export function isWindowsInferenceVariant(variant) {
  return WINDOWS_INFERENCE_VARIANTS.includes(variant) || variant === 'full';
}

export function parseLinuxReleaseVariant(variant) {
  const match = /^(deb|appimage)-(cpu|cuda)$/.exec(variant ?? '');
  if (!match) return null;
  return { format: match[1], edition: match[2] };
}

export function isMacosInferenceVariant(variant) {
  return variant === 'default' || MACOS_INFERENCE_VARIANTS.includes(variant);
}

export function releaseArtifactDirectory(platform, arch, variant) {
  return `${platform}-${arch}-${variant}`;
}

export function candidateTargetFromReleaseTarget(releaseTarget) {
  const [platform, arch, variant] = releaseTarget.split(':');
  if (!platform || !arch || !variant) {
    throw new Error(`Invalid release target: ${releaseTarget}`);
  }
  return `${platform}-${arch}-${variant}`;
}

export function resolveReleaseArtifactFormat(platform, variant, kind = 'installer') {
  if (kind === 'metadata') {
    return { extension: '.yml', contentType: 'application/x-yaml' };
  }
  if (kind === 'blockmap') {
    return { extension: '.blockmap', contentType: 'application/octet-stream' };
  }
  if (kind === 'updater' && platform === 'darwin' && isMacosInferenceVariant(variant)) {
    return { extension: '.zip', contentType: 'application/zip' };
  }
  if (platform === 'win32' && isWindowsInferenceVariant(variant)) {
    return {
      extension: '.exe',
      contentType: 'application/vnd.microsoft.portable-executable',
    };
  }
  if (platform === 'darwin' && isMacosInferenceVariant(variant)) {
    return { extension: '.dmg', contentType: 'application/x-apple-diskimage' };
  }
  const linuxVariant = parseLinuxReleaseVariant(variant);
  if (platform === 'linux' && linuxVariant?.format === 'deb') {
    return { extension: '.deb', contentType: 'application/vnd.debian.binary-package' };
  }
  if (platform === 'linux' && linuxVariant?.format === 'appimage') {
    return { extension: '.appimage', contentType: 'application/vnd.appimage' };
  }
  throw new Error(`Unsupported release target: ${platform}:${variant}`);
}

/** @type {Map<string, string>} */
export const ELECTRON_UPDATER_METADATA_FILENAMES = new Map([
  ...WINDOWS_INFERENCE_VARIANTS.map(variant => [`win32:x64:${variant}`, 'latest.yml']),
  ...MACOS_INFERENCE_VARIANTS.flatMap(edition => [
    [`darwin:x64:${edition}`, 'latest-mac.yml'],
    [`darwin:arm64:${edition}`, 'latest-mac.yml'],
  ]),
  ...LINUX_INFERENCE_VARIANTS.flatMap(edition => [
    [`linux:x64:deb-${edition}`, 'latest-linux.yml'],
    [`linux:x64:appimage-${edition}`, 'latest-linux.yml'],
  ]),
]);

export function listElectronUpdaterVerifySpecs(manifestRoot = 'manifest/electron') {
  return listRequiredReleaseTargets().map(releaseTarget => {
    const metadataName = ELECTRON_UPDATER_METADATA_FILENAMES.get(releaseTarget);
    if (!metadataName) {
      throw new Error(`Missing electron-updater metadata mapping for ${releaseTarget}`);
    }
    const targetFile = candidateTargetFromReleaseTarget(releaseTarget);
    return `${manifestRoot}/${targetFile}/${metadataName}:${releaseTarget}`;
  });
}
