#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bucket = process.env.R2_BUCKET ?? 'zhiyuan-releases';
const endpoint = process.env.AWS_ENDPOINT_URL_S3;
if (!endpoint || !process.env.AWS_ACCESS_KEY_ID) {
  process.stderr.write('R2 credentials and AWS_ENDPOINT_URL_S3 are required\n');
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'stable-commit-'));
try {
  const aws = (...args) =>
    execFileSync('aws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  const pointerKey = 'channels/stable-pointer.json';
  let stableKey = 'channels/stable.json';
  try {
    aws('s3api', 'head-object', '--bucket', bucket, '--key', pointerKey);
    aws('s3api', 'get-object', '--bucket', bucket, '--key', pointerKey, join(dir, 'pointer.json'));
    const generation = JSON.parse(readFileSync(join(dir, 'pointer.json'), 'utf8')).generation;
    if (typeof generation !== 'string' || !/^[A-Za-z0-9._-]+$/.test(generation)) {
      throw new Error('Stable pointer generation is invalid');
    }
    stableKey = `generations/${generation}/legacy/stable.json`;
  } catch {
    // Fall back to the legacy stable manifest location.
  }

  try {
    aws('s3api', 'head-object', '--bucket', bucket, '--key', stableKey);
  } catch {
    process.stdout.write('\n');
    process.exit(0);
  }

  aws('s3api', 'get-object', '--bucket', bucket, '--key', stableKey, join(dir, 'stable.json'));
  const stable = JSON.parse(readFileSync(join(dir, 'stable.json'), 'utf8'));
  const manifest = stable.manifests?.[0];
  if (!manifest?.payload) {
    throw new Error('Stable manifest payload is missing');
  }
  const payload = JSON.parse(Buffer.from(manifest.payload, 'base64url').toString('utf8'));
  const commitSha = payload?.source?.commitSha;
  if (typeof commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new Error('Stable manifest source commit is invalid');
  }
  process.stdout.write(`${commitSha}\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
