import fs from 'node:fs/promises';
import path from 'node:path';

const [objectListPath, outputDirectory] = process.argv.slice(2);
if (!objectListPath || !outputDirectory) {
  throw new Error('usage: plan-xiaoruan-cleanup.mjs <object-list> <output-dir>');
}

const retentionMs = 24 * 60 * 60 * 1000;
const cutoff = Date.now() - retentionMs;

// Pinned final release prefix for Xiaoruan (v1.0.6)
const protectedPrefixes = [
  'builds/0e1ed3f56ccfda3ba9c3333dd9cfd7f2e3e7e4ed/',
];

const objectList = JSON.parse(await fs.readFile(objectListPath, 'utf8'));
const objects = Array.isArray(objectList.Contents) ? objectList.Contents : [];

const keysToDelete = objects
  .filter(object => {
    if (
      !object ||
      typeof object.Key !== 'string' ||
      !object.Key.startsWith('builds/') ||
      protectedPrefixes.some(prefix => object.Key.startsWith(prefix))
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
  `[XiaoruanCleanup] planned deletion of ${keysToDelete.length} unreferenced objects older than 24 hours`,
);
