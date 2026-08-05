import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [releaseVersion, outputPath, ...specs] = process.argv.slice(2);
if (!releaseVersion || !outputPath || specs.length === 0) {
  throw new Error(
    'usage: upload-update-artifacts.mjs <version> <metadata-output> <file:platform:arch:variant>...',
  );
}

const bucket = process.env.R2_BUCKET;
if (!bucket) throw new Error('R2_BUCKET is required');

function resolveArtifactFormat(platform, variant) {
  if (platform === 'win32' && (variant === 'lite' || variant === 'full')) {
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
  throw new Error(`Unsupported release target: ${platform}:${variant}`);
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function runAws(args, options = {}) {
  const result = spawnSync('aws', args, { encoding: 'utf8', stdio: options.stdio ?? 'inherit' });
  if (result.error) throw result.error;
  return result;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function uploadWithRetry(filePath, objectKey) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = runAws(
      [
        's3',
        'cp',
        filePath,
        `s3://${bucket}/${objectKey}`,
        '--cache-control',
        'public, max-age=31536000, immutable',
        '--no-progress',
      ],
      { stdio: 'inherit' },
    );
    if (result.status === 0) return;
    if (attempt === 3) throw new Error(`Upload failed after ${attempt} attempts: ${objectKey}`);
    console.warn(`[UpdateRelease] Upload attempt ${attempt} failed for ${objectKey}; retrying...`);
    await sleep(attempt * 10_000);
  }
}

const artifacts = [];
for (const spec of specs) {
  const [filePath, platform, arch, variant, ...extra] = spec.split(':');
  if (!filePath || !platform || !arch || !variant || extra.length > 0) {
    throw new Error(`Invalid artifact spec: ${spec}`);
  }
  const format = resolveArtifactFormat(platform, variant);
  const stat = await fsp.stat(filePath);
  const filename = path.basename(filePath);
  if (!stat.isFile() || stat.size === 0 || path.extname(filename).toLowerCase() !== format.extension) {
    throw new Error(`Invalid ${platform} artifact: ${filePath}`);
  }

  const key = `releases/${releaseVersion}/${platform}-${arch}-${variant}/${filename}`;
  await uploadWithRetry(filePath, key);
  const remote = runAws(
    ['s3api', 'head-object', '--bucket', bucket, '--key', key, '--query', 'ContentLength', '--output', 'text'],
    { stdio: 'pipe' },
  );
  if (remote.status !== 0 || Number.parseInt(remote.stdout.trim(), 10) !== stat.size) {
    throw new Error(`Remote size verification failed: ${key}`);
  }
  artifacts.push({
    platform,
    arch,
    variant,
    filename,
    key,
    size: stat.size,
    sha256: await sha256File(filePath),
  });
}

await fsp.writeFile(
  outputPath,
  `${JSON.stringify({ schemaVersion: 1, releaseVersion, artifacts }, null, 2)}\n`,
);
