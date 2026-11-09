import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function releaseIdentity(env) {
  const identity = {
    version: env.APP_BUILD_VERSION,
    sourceCommit: env.ZHIYUAN_SOURCE_COMMIT,
    edition: env.ZHIYUAN_UPDATE_VARIANT,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
  };
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(identity.version ?? '') ||
    !/^[a-f0-9]{40}$/.test(identity.sourceCommit ?? '') ||
    !['cpu', 'cuda'].includes(identity.edition) ||
    !/^\d+$/.test(identity.runId ?? '') ||
    !/^[1-9]\d*$/.test(identity.runAttempt ?? '')
  ) {
    throw new Error('Linux release acceptance requires complete release and run identity');
  }
  return identity;
}

export function expectedDebVersion(version) {
  // electron-builder 26.16.1 LinuxTargetHelper replaces hyphens for Debian ordering.
  return version.replace(/-/g, '~');
}

export function installedExecutable(installedFiles, executableName) {
  const matches = installedFiles.filter(
    file => file.startsWith('/opt/') && path.basename(file) === executableName,
  );
  if (matches.length !== 1) {
    throw new Error('Installed package must own exactly one application executable under /opt');
  }
  return matches[0];
}

export async function releaseArtifacts(directory) {
  const entries = await fs.readdir(directory);
  const artifacts = {};
  for (const [format, extension] of [['deb', '.deb'], ['appimage', '.AppImage']]) {
    const matches = entries.filter(name => name.endsWith(extension));
    if (matches.length !== 1) throw new Error(`Expected exactly one final ${format} artifact`);
    const artifact = path.resolve(directory, matches[0]);
    if (!(await fs.lstat(artifact)).isFile()) {
      throw new Error(`Final ${format} artifact must be a regular file`);
    }
    artifacts[format] = artifact;
  }
  return artifacts;
}

export async function fingerprintArtifacts(artifacts) {
  const result = {};
  for (const [format, file] of Object.entries(artifacts)) {
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of createReadStream(file)) {
      hash.update(chunk);
      size += chunk.length;
    }
    result[format] = { file: path.basename(file), size, sha256: hash.digest('hex') };
  }
  return result;
}

export function verifyEvidence(evidence, identity, artifacts) {
  if (evidence?.schemaVersion !== 1 || evidence.status !== 'passed') {
    throw new Error('Linux release acceptance evidence is not passed');
  }
  for (const [key, value] of Object.entries(identity)) {
    if (evidence.identity?.[key] !== value) {
      throw new Error(`Linux release acceptance identity mismatch: ${key}`);
    }
  }
  for (const [format, artifact] of Object.entries(artifacts)) {
    const accepted = evidence.artifacts?.[format];
    if (
      accepted?.renderer !== 'passed' ||
      accepted.file !== artifact.file ||
      accepted.size !== artifact.size ||
      accepted.sha256 !== artifact.sha256
    ) {
      throw new Error(`Linux release acceptance artifact mismatch: ${format}`);
    }
  }
}
