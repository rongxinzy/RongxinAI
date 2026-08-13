import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const CandidateTarget = {
  WindowsX64Lite: 'win32-x64-lite',
  MacArm64Default: 'darwin-arm64-default',
  LinuxX64AppImage: 'linux-x64-appimage',
  LinuxX64Deb: 'linux-x64-deb',
};

const REQUIRED_KINDS = new Map([
  [CandidateTarget.WindowsX64Lite, ['installer', 'updater', 'blockmap', 'metadata']],
  [CandidateTarget.MacArm64Default, ['installer', 'updater', 'blockmap', 'metadata']],
  [CandidateTarget.LinuxX64AppImage, ['installer', 'updater', 'metadata']],
  [CandidateTarget.LinuxX64Deb, ['installer', 'updater', 'metadata']],
]);

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
    throw new Error(`Candidate source commit mismatch: ${manifest.sourceCommit}`);
  }
  if (String(manifest.candidateRunId) !== expectedRunId) {
    throw new Error(`Candidate run ID mismatch: ${manifest.candidateRunId}`);
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
  validateFilename(manifestName);
  if (!Array.isArray(specs) || specs.length === 0) throw new Error('Candidate artifact specs are required');

  const artifacts = [];
  const copiedFiles = new Map();
  for (const spec of specs) {
    const parsed = parseSpec(spec);
    const filename = validateFilename(path.basename(parsed.filePath));
    const relativePath = path.posix.join('payload', parsed.target, filename);
    const description = await describeFile(parsed.filePath);
    const existing = copiedFiles.get(relativePath);
    if (existing) {
      if (
        existing.size !== description.size ||
        existing.sha256 !== description.sha256 ||
        existing.sha512 !== description.sha512
      ) {
        throw new Error(`Candidate artifacts collide at ${relativePath}`);
      }
    } else {
      const destination = path.join(outputDirectory, ...relativePath.split('/'));
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.copyFile(parsed.filePath, destination);
      copiedFiles.set(relativePath, description);
    }
    artifacts.push({
      platform: parsed.platform,
      arch: parsed.arch,
      variant: parsed.variant,
      kind: parsed.kind,
      filename,
      relativePath,
      ...description,
    });
  }

  artifacts.sort((left, right) =>
    `${left.platform}:${left.arch}:${left.variant}:${left.kind}`.localeCompare(
      `${right.platform}:${right.arch}:${right.variant}:${right.kind}`,
    ),
  );
  const manifest = {
    schemaVersion: 1,
    releaseVersion,
    sourceCommit,
    candidateRunId: String(candidateRunId),
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
