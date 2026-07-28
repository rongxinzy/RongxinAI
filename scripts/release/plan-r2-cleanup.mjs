import fs from 'node:fs/promises';
import path from 'node:path';

import {
  loadTrustedReleaseKey,
  readAndVerifyCollection,
  referencedObjectKeys,
} from './update-manifest-lib.mjs';

const [stablePath, previousPath, previousHeadPath, objectListPath, outputDirectory] =
  process.argv.slice(2);
if (!stablePath || !previousPath || !previousHeadPath || !objectListPath || !outputDirectory) {
  throw new Error(
    'usage: plan-r2-cleanup.mjs <stable> <previous-or-dash> <previous-head-or-dash> <object-list> <output-dir>',
  );
}

const retentionMs = 24 * 60 * 60 * 1000;
const cutoff = Date.now() - retentionMs;
const trustedKey = loadTrustedReleaseKey();
const stableEntries = await readAndVerifyCollection(stablePath, trustedKey);
const referencedKeys = referencedObjectKeys(stableEntries);

if (previousPath !== '-' && previousHeadPath !== '-') {
  const previousHead = JSON.parse(await fs.readFile(previousHeadPath, 'utf8'));
  const previousPublishedAt = Date.parse(previousHead.LastModified);
  if (!Number.isFinite(previousPublishedAt)) {
    throw new Error('stable.previous.json has an invalid LastModified timestamp');
  }
  if (previousPublishedAt >= cutoff) {
    const previousEntries = await readAndVerifyCollection(previousPath, trustedKey);
    for (const key of referencedObjectKeys(previousEntries)) referencedKeys.add(key);
  }
}

const objectList = JSON.parse(await fs.readFile(objectListPath, 'utf8'));
const objects = Array.isArray(objectList.Contents) ? objectList.Contents : [];
const keysToDelete = objects
  .filter(object => {
    if (
      !object ||
      typeof object.Key !== 'string' ||
      !object.Key.startsWith('releases/') ||
      referencedKeys.has(object.Key)
    ) {
      return false;
    }
    const lastModified = Date.parse(object.LastModified);
    return Number.isFinite(lastModified) && lastModified < cutoff;
  })
  .map(object => object.Key);

await fs.mkdir(outputDirectory, { recursive: true });
for (let index = 0; index < keysToDelete.length; index += 1000) {
  const batch = keysToDelete.slice(index, index + 1000);
  const batchPath = path.join(
    outputDirectory,
    `delete-${String(index / 1000 + 1).padStart(3, '0')}.json`,
  );
  await fs.writeFile(
    batchPath,
    JSON.stringify({ Objects: batch.map(Key => ({ Key })), Quiet: true }),
  );
}

console.log(
  `[UpdateRelease] planned deletion of ${keysToDelete.length} unreferenced objects older than 24 hours`,
);
