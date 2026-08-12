import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

const args = process.argv.slice(2);
const metadataFlag = args.indexOf('--artifact-metadata');
const [releaseVersion, ...metadataSpecs] = metadataFlag === -1 ? args : args.slice(0, metadataFlag);
const artifactMetadataPaths = metadataFlag === -1 ? [] : args.slice(metadataFlag + 1);
if (!releaseVersion || metadataSpecs.length === 0 || artifactMetadataPaths.length === 0) {
  throw new Error(
    'usage: verify-electron-updater-generation.mjs <version> <metadata-file:platform:arch:variant>... --artifact-metadata <upload-metadata.json>...',
  );
}

const expectedMetadataNames = new Map([
  ['win32:x64:lite', 'latest.yml'],
  ['darwin:arm64:default', 'latest-mac.yml'],
  ['linux:x64:appimage', 'latest-linux.yml'],
  ['linux:x64:deb', 'latest-linux.yml'],
]);
const artifacts = (
  await Promise.all(
    artifactMetadataPaths.map(async metadataPath => {
      const value = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      if (value?.schemaVersion !== 1 || value.releaseVersion !== releaseVersion || !Array.isArray(value.artifacts)) {
        throw new Error(`Invalid artifact metadata: ${metadataPath}`);
      }
      return value.artifacts;
    }),
  )
).flat();

const seenTargets = new Set();
for (const spec of metadataSpecs) {
  const [metadataPath, platform, arch, variant, ...extra] = spec.split(':');
  if (!metadataPath || !platform || !arch || !variant || extra.length > 0) {
    throw new Error(`Invalid metadata spec: ${spec}`);
  }
  const target = `${platform}:${arch}:${variant}`;
  const expectedName = expectedMetadataNames.get(target);
  if (!expectedName || path.basename(metadataPath) !== expectedName) {
    throw new Error(`Unexpected electron-updater metadata target: ${target}`);
  }
  if (seenTargets.has(target)) {
    throw new Error(`Duplicate electron-updater metadata target: ${target}`);
  }
  seenTargets.add(target);
  const metadata = yaml.load(await fs.readFile(metadataPath, 'utf8'));
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || metadata.version !== releaseVersion) {
    throw new Error(`Invalid electron-updater metadata: ${metadataPath}`);
  }
  if (!Array.isArray(metadata.files) || metadata.files.length !== 1) {
    throw new Error(`Electron-updater metadata must have exactly one updater file: ${metadataPath}`);
  }
  const [file] = metadata.files;
  const baseUrl = `https://updates.rongxzyai.com/v2/electron/releases/${releaseVersion}/${platform}/${arch}/${variant}/`;
  if (
    !file ||
    typeof file.url !== 'string' ||
    !file.url.startsWith(baseUrl) ||
    typeof file.sha512 !== 'string' ||
    !/^[A-Za-z0-9+/]{86}(?:==)?$/.test(file.sha512) ||
    metadata.path !== file.url ||
    metadata.sha512 !== file.sha512
  ) {
    throw new Error(`Electron-updater metadata does not use the versioned Worker URL: ${metadataPath}`);
  }
  const filename = decodeURIComponent(file.url.slice(baseUrl.length));
  if (
    !filename ||
    filename.length > 240 ||
    filename === '.' ||
    filename === '..' ||
    /[\\/\u0000-\u001f\u007f]/.test(filename)
  ) {
    throw new Error(`Electron-updater metadata has an unsafe artifact path: ${metadataPath}`);
  }
  const uploadedArtifact = artifacts.find(
    artifact =>
      artifact.platform === platform &&
      artifact.arch === arch &&
      artifact.variant === variant &&
      artifact.kind === 'updater' &&
      artifact.filename === filename,
  );
  if (!uploadedArtifact || uploadedArtifact.sha512 !== file.sha512) {
    throw new Error(`Electron-updater metadata does not match an uploaded updater artifact: ${target}`);
  }
}

if (
  seenTargets.size !== expectedMetadataNames.size ||
  [...expectedMetadataNames.keys()].some(target => !seenTargets.has(target))
) {
  throw new Error('Electron-updater generation must contain exactly the supported updater targets');
}
console.log(`[UpdateRelease] electron-updater generation ${releaseVersion} passed metadata validation`);
