import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { gte, lte, valid } from 'semver';

export const RETENTION_MS = 24 * 60 * 60 * 1000;

export function isDifferentialBaseObject(key, minimumVersion, currentVersion) {
  const match = /^(releases|generations)\/([^/]+)\/(.+)$/.exec(key);
  if (
    !match ||
    !valid(match[2]) ||
    !gte(match[2], minimumVersion) ||
    !lte(match[2], currentVersion)
  ) {
    return false;
  }
  // Versioned redirects need the generation metadata even after the old full installer expires.
  return match[1] === 'generations' || /\.(exe|zip)\.blockmap$/i.test(match[3]);
}

export function isPreviousReleaseProtected(previousHead, now = Date.now()) {
  const publishedAt = Date.parse(previousHead.LastModified);
  if (!Number.isFinite(publishedAt)) {
    throw new Error('stable.previous.json has an invalid LastModified timestamp');
  }
  return publishedAt >= now - RETENTION_MS;
}

if (process.argv[1] && import.meta.url === pathToFileURL(await fs.realpath(process.argv[1])).href) {
  const headPath = process.argv[2];
  if (!headPath) throw new Error('usage: cleanup-retention.mjs <previous-head>');
  const previousHead = JSON.parse(await fs.readFile(headPath, 'utf8'));
  console.log(isPreviousReleaseProtected(previousHead));
}
