import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  candidateTargetFromReleaseTarget,
  listRequiredReleaseTargets,
} from './inference-edition-targets.mjs';

function toCandidateEnumName(platform, arch, variant) {
  const platformPart =
    platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'Mac' : 'Linux';
  const archPart = arch === 'arm64' ? 'Arm64' : 'X64';
  const variantPart = variant
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `${platformPart}${archPart}${variantPart}`;
}

/** @type {Record<string, string>} */
export const CandidateTarget = {};

/** @type {Map<string, string[]>} */
const REQUIRED_KINDS = new Map();

for (const releaseTarget of listRequiredReleaseTargets()) {
  const [platform, arch, variant] = releaseTarget.split(':');
  const candidateTarget = candidateTargetFromReleaseTarget(releaseTarget);
  CandidateTarget[toCandidateEnumName(platform, arch, variant)] = candidateTarget;
  REQUIRED_KINDS.set(
    candidateTarget,
    platform === 'linux'
      ? ['installer', 'updater', 'metadata']
      : ['installer', 'updater', 'blockmap', 'metadata'],
  );
}

function validateReleaseVersion(value) {
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(value)) {
    throw new Error(`Invalid release version: ${value}`);
  }
  return value;
}

function validateCommit(value) {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`Invalid source commit: ${value}`);
  return value;
}

function validateRunId(value) {
  if (!/^[1-9][0-9]*$/.test(String(value))) throw new Error(`Invalid candidate run ID: ${value}`);
  return String(value);
}

function validateFilename(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 240 ||
    value === '.' ||
    value === '..' ||
    /[\\/\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`Unsafe candidate filename: ${value}`);
  }
  return value;
}

function validateRelativePath(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('payload/') ||
    path.posix.isAbsolute(value) ||
    value.split('/').includes('..') ||
    value.includes('\\')
  ) {
    throw new Error(`Unsafe candidate artifact path: ${value}`);
  }
  return value;
}

function parseSpec(spec) {
  const parts = spec.split(':');
  if (parts.length < 5) throw new Error(`Invalid candidate artifact spec: ${spec}`);
  const kind = parts.pop();
  const variant = parts.pop();
  const arch = parts.pop();
  const platform = parts.pop();
  const filePath = parts.join(':');
  const target = `${platform}-${arch}-${variant}`;
  if (!filePath || !REQUIRED_KINDS.has(target) || !REQUIRED_KINDS.get(target).includes(kind)) {
    throw new Error(`Invalid candidate artifact spec: ${spec}`);
  }
  return { filePath, platform, arch, variant, target, kind };
}

async function hashFile(filePath, algorithm, encoding) {
  const hash = crypto.createHash(algorithm);
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest(encoding);
}

async function describeFile(filePath) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Candidate artifact is missing or empty: ${filePath}`);
  return {
    size: stat.size,
    sha256: await hashFile(filePath, 'sha256', 'hex'),
    sha512: await hashFile(filePath, 'sha512', 'base64'),
  };
}

function validateIdentity(manifest, expectedVersion, expectedCommit, expectedRunId) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.schemaVersion !== 1) {
    throw new Error('Invalid release candidate manifest');
  }
  if (manifest.releaseVersion !== expectedVersion) {
    throw new Error(`Candidate version mismatch: ${manifest.releaseVersion}`);
  }
  if (manifest.sourceCommit !== expectedCommit) {
    throw new Error('Candidate source commit mismatch');
  }
  if (String(manifest.candidateRunId) !== expectedRunId) {
    throw new Error('Candidate run ID mismatch');
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error('Candidate manifest has no artifacts');
  }
}

export async function createCandidateManifest({
  releaseVersion,
  sourceCommit,
  candidateRunId,
  outputDirectory,
  manifestName,
  specs,
}) {
  validateReleaseVersion(releaseVersion);
  validateCommit(sourceCommit);
  validateRunId(candidateRunId);
  if (!Array.isArray(specs) || specs.length === 0) throw new Error('Candidate artifact specs are required');

  const artifacts = [];
  for (const spec of specs) {
    const { filePath, platform, arch, variant, target, kind } = parseSpec(spec);
    const { size, sha256, sha512 } = await describeFile(filePath);
    const filename = path.basename(filePath);
    validateFilename(filename);
    const relativePath = `payload/${target}/${filename}`;
    validateRelativePath(relativePath);
    await fsp.mkdir(path.join(outputDirectory, 'payload', target), { recursive: true });
    await fsp.copyFile(filePath, path.join(outputDirectory, relativePath));
    artifacts.push({ platform, arch, variant, kind, filename, relativePath, size, sha256, sha512 });
  }

  const manifest = {
    schemaVersion: 1,
    releaseVersion,
    sourceCommit,
    candidateRunId,
    artifacts,
  };
  await verifyCandidateManifests({
    releaseVersion,
    sourceCommit,
    candidateRunId,
    manifests: [manifest],
    payloadRoots: [outputDirectory],
    requireComplete: false,
  });
  await fsp.mkdir(outputDirectory, { recursive: true });
  await fsp.writeFile(path.join(outputDirectory, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function verifyCandidateManifests({
  releaseVersion,
  sourceCommit,
  candidateRunId,
  manifests,
  payloadRoots = [],
  requireComplete = true,
}) {
  validateReleaseVersion(releaseVersion);
  validateCommit(sourceCommit);
  const expectedRunId = validateRunId(candidateRunId);
  if (!Array.isArray(manifests) || manifests.length === 0) throw new Error('Candidate manifests are required');
  if (payloadRoots.length !== 0 && payloadRoots.length !== manifests.length) {
    throw new Error('Each candidate manifest must have one payload root');
  }

  const identities = new Set();
  for (const [manifestIndex, manifest] of manifests.entries()) {
    validateIdentity(manifest, releaseVersion, sourceCommit, expectedRunId);
    for (const artifact of manifest.artifacts) {
      const target = `${artifact.platform}-${artifact.arch}-${artifact.variant}`;
      const requiredKinds = REQUIRED_KINDS.get(target);
      const identity = `${target}:${artifact.kind}`;
      if (!requiredKinds?.includes(artifact.kind) || identities.has(identity)) {
        throw new Error(`Unexpected or duplicate candidate artifact: ${identity}`);
      }
      identities.add(identity);
      validateFilename(artifact.filename);
      validateRelativePath(artifact.relativePath);
      if (
        path.posix.dirname(artifact.relativePath) !== `payload/${target}` ||
        path.posix.basename(artifact.relativePath) !== artifact.filename
      ) {
        throw new Error(`Candidate filename does not match its path: ${artifact.relativePath}`);
      }
      if (
        !Number.isSafeInteger(artifact.size) ||
        artifact.size <= 0 ||
        !/^[0-9a-f]{64}$/.test(artifact.sha256) ||
        !/^[A-Za-z0-9+/]{86}==$/.test(artifact.sha512)
      ) {
        throw new Error(`Candidate artifact integrity is invalid: ${identity}`);
      }
      if (payloadRoots.length > 0) {
        const filePath = path.join(payloadRoots[manifestIndex], ...artifact.relativePath.split('/'));
        const actual = await describeFile(filePath);
        if (
          actual.size !== artifact.size ||
          actual.sha256 !== artifact.sha256 ||
          actual.sha512 !== artifact.sha512
        ) {
          throw new Error(`Candidate artifact bytes do not match the manifest: ${identity}`);
        }
      }
    }
  }

  if (requireComplete) {
    const required = [...REQUIRED_KINDS].flatMap(([target, kinds]) => kinds.map(kind => `${target}:${kind}`));
    const missing = required.filter(identity => !identities.has(identity));
    if (missing.length > 0) throw new Error(`Candidate is incomplete: ${missing.join(', ')}`);
    if (identities.size !== required.length) throw new Error('Candidate contains unexpected artifacts');
  }
}
