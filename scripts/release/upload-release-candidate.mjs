import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyCandidateManifests } from './release-candidate-manifest.mjs';

export function artifactFormat(platform, variant, kind) {
  if (kind === 'metadata') return { extension: '.yml', contentType: 'application/x-yaml' };
  if (kind === 'blockmap') return { extension: '.blockmap', contentType: 'application/octet-stream' };
  if (kind === 'updater' && platform === 'darwin' && variant === 'default') {
    return { extension: '.zip', contentType: 'application/zip' };
  }
  if (platform === 'win32' && variant === 'lite') {
    return { extension: '.exe', contentType: 'application/vnd.microsoft.portable-executable' };
  }
  if (platform === 'darwin' && variant === 'default') {
    return { extension: '.dmg', contentType: 'application/x-apple-diskimage' };
  }
  if (platform === 'linux' && variant === 'deb') {
    return { extension: '.deb', contentType: 'application/vnd.debian.binary-package' };
  }
  if (platform === 'linux' && variant === 'appimage') {
    return { extension: '.appimage', contentType: 'application/vnd.appimage' };
  }
  throw new Error(`Unsupported release candidate artifact: ${platform}:${variant}:${kind}`);
}

function runAwsCommand(commandArgs, stdio = 'inherit') {
  const result = spawnSync('aws', commandArgs, { encoding: 'utf8', stdio });
  if (result.error) throw result.error;
  return result;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function immutableKey(releaseVersion, artifact) {
  const target = `${artifact.platform}-${artifact.arch}-${artifact.variant}`;
  return artifact.kind === 'metadata'
    ? `generations/${releaseVersion}/electron/${target}/${artifact.filename}`
    : `releases/${releaseVersion}/${target}/${artifact.filename}`;
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

export async function verifyLocalArtifact(filePath, artifact) {
  const format = artifactFormat(artifact.platform, artifact.variant, artifact.kind);
  const stat = await fsp.stat(filePath);
  if (
    !stat.isFile() ||
    stat.size !== artifact.size ||
    path.extname(artifact.filename).toLowerCase() !== format.extension ||
    (await hashFile(filePath, 'sha256', 'hex')) !== artifact.sha256 ||
    (await hashFile(filePath, 'sha512', 'base64')) !== artifact.sha512
  ) {
    throw new Error(`Candidate bytes changed before upload: ${artifact.relativePath}`);
  }
  return format;
}

export function createImmutableUploader({
  bucket,
  releaseVersion,
  runAws = runAwsCommand,
  wait = sleep,
}) {
  if (!bucket) throw new Error('R2_BUCKET is required');

  return async function uploadImmutable(filePath, artifact, uploadedObjects) {
    const key = immutableKey(releaseVersion, artifact);
    const format = await verifyLocalArtifact(filePath, artifact);
    const existingLocal = uploadedObjects.get(key);
    if (existingLocal) {
      if (
        existingLocal.size !== artifact.size ||
        existingLocal.sha256 !== artifact.sha256 ||
        existingLocal.sha512 !== artifact.sha512
      ) {
        throw new Error(`Candidate artifacts collide at immutable key ${key}`);
      }
      return key;
    }

    let available = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const existing = runAws(
        [
          's3api',
          'head-object',
          '--bucket',
          bucket,
          '--key',
          key,
          '--query',
          '{size:ContentLength,sha256:Metadata.sha256,sha512:Metadata.sha512}',
          '--output',
          'json',
        ],
        'pipe',
      );
      if (existing.status === 0) {
        const remote = JSON.parse(existing.stdout);
        if (
          remote.size !== artifact.size ||
          remote.sha256 !== artifact.sha256 ||
          remote.sha512 !== artifact.sha512
        ) {
          throw new Error(`Immutable object already exists with different content: ${key}`);
        }
        available = true;
        break;
      }
      if (!/404|Not Found|NoSuchKey/i.test(existing.stderr)) {
        throw new Error(`Could not inspect immutable object ${key}: ${existing.stderr.trim()}`);
      }
      const uploaded = runAws([
        's3api',
        'put-object',
        '--bucket',
        bucket,
        '--key',
        key,
        '--body',
        filePath,
        '--cache-control',
        'public, max-age=31536000, immutable',
        '--content-type',
        format.contentType,
        '--metadata',
        `sha256=${artifact.sha256},sha512=${artifact.sha512}`,
        '--if-none-match',
        '*',
      ]);
      if (uploaded.status === 0) {
        available = true;
        break;
      }
      if (attempt < 3) await wait(attempt * 1_000);
    }
    if (!available) throw new Error(`Failed to upload immutable object: ${key}`);

    const remoteSize = runAws(
      [
        's3api',
        'head-object',
        '--bucket',
        bucket,
        '--key',
        key,
        '--query',
        'ContentLength',
        '--output',
        'text',
      ],
      'pipe',
    );
    if (remoteSize.status !== 0 || Number.parseInt(remoteSize.stdout.trim(), 10) !== artifact.size) {
      throw new Error(`Remote size verification failed: ${key}`);
    }
    uploadedObjects.set(key, artifact);
    return key;
  };
}

export async function uploadReleaseCandidate({
  releaseVersion,
  sourceCommit,
  candidateRunId,
  outputDirectory,
  manifestPaths,
  payloadRoots,
  bucket = process.env.R2_BUCKET,
  runAws = runAwsCommand,
  wait = sleep,
}) {
  const manifests = await Promise.all(
    manifestPaths.map(async manifestPath => JSON.parse(await fsp.readFile(manifestPath, 'utf8'))),
  );
  await verifyCandidateManifests({
    releaseVersion,
    sourceCommit,
    candidateRunId,
    manifests,
    payloadRoots,
  });

  const uploadImmutable = createImmutableUploader({ bucket, releaseVersion, runAws, wait });
  await fsp.mkdir(outputDirectory, { recursive: true });
  const uploadedObjects = new Map();
  for (const [manifestIndex, manifest] of manifests.entries()) {
    const artifacts = [];
    for (const artifact of manifest.artifacts) {
      const filePath = path.join(payloadRoots[manifestIndex], ...artifact.relativePath.split('/'));
      const key = await uploadImmutable(filePath, artifact, uploadedObjects);
      artifacts.push({
        platform: artifact.platform,
        arch: artifact.arch,
        variant: artifact.variant,
        kind: artifact.kind,
        filename: artifact.filename,
        key,
        size: artifact.size,
        sha256: artifact.sha256,
        sha512: artifact.sha512,
      });
    }
    await fsp.writeFile(
      path.join(outputDirectory, `update-artifacts-${manifestIndex + 1}.json`),
      `${JSON.stringify(
        { schemaVersion: 1, releaseVersion, sourceCommit, candidateRunId: String(candidateRunId), artifacts },
        null,
        2,
      )}\n`,
    );
  }
  console.log(
    `[ReleasePromotion] uploaded ${uploadedObjects.size} immutable objects from candidate run ${candidateRunId}`,
  );
}

async function main(args) {
  const payloadFlag = args.indexOf('--payload-roots');
  const manifestPaths = payloadFlag === -1 ? [] : args.slice(4, payloadFlag);
  const payloadRoots = payloadFlag === -1 ? [] : args.slice(payloadFlag + 1);
  const [releaseVersion, sourceCommit, candidateRunId, outputDirectory] = args;
  if (
    !releaseVersion ||
    !sourceCommit ||
    !candidateRunId ||
    !outputDirectory ||
    manifestPaths.length === 0 ||
    manifestPaths.length !== payloadRoots.length
  ) {
    throw new Error(
      'usage: upload-release-candidate.mjs <version> <commit> <run-id> <output-directory> <manifest.json>... --payload-roots <directory>...',
    );
  }
  await uploadReleaseCandidate({
    releaseVersion,
    sourceCommit,
    candidateRunId,
    outputDirectory,
    manifestPaths,
    payloadRoots,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
