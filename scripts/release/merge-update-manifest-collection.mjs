import fs from 'node:fs/promises';
import path from 'node:path';

import { artifactIdentity, readAndVerifyCollection } from './update-manifest-lib.mjs';

const [basePath, patchPath, outputPath] = process.argv.slice(2);
if (!basePath || !patchPath || !outputPath) {
  throw new Error(
    'usage: merge-update-manifest-collection.mjs <base.json|-> <patch.json> <output.json>',
  );
}

async function readCollection(filePath) {
  if (filePath === '-') return { schemaVersion: 1, manifests: [] };
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

const base = await readCollection(basePath);
const patch = await readCollection(patchPath);
if (base.schemaVersion !== 1 || patch.schemaVersion !== 1) {
  throw new Error('Manifest collections must use schemaVersion 1');
}

const baseEntries = base.manifests?.length ? await readAndVerifyCollection(basePath) : [];
const patchEntries = await readAndVerifyCollection(patchPath);

const byTarget = new Map();
for (const entry of baseEntries) {
  byTarget.set(artifactIdentity(entry.payload).target, entry.envelope);
}
for (const entry of patchEntries) {
  byTarget.set(artifactIdentity(entry.payload).target, entry.envelope);
}

const patchVersion = patchEntries[0]?.payload.version;
const patchCommit = patchEntries[0]?.payload.source?.commitSha;
for (const entry of patchEntries) {
  if (entry.payload.version !== patchVersion) {
    throw new Error('Patch manifests must share the same release version');
  }
  if (entry.payload.source?.commitSha !== patchCommit) {
    throw new Error('Patch manifests must share the same source commit');
  }
}
for (const entry of baseEntries) {
  const target = artifactIdentity(entry.payload).target;
  if (patchEntries.some(patchEntry => artifactIdentity(patchEntry.payload).target === target)) {
    continue;
  }
  if (patchVersion && entry.payload.version !== patchVersion) {
    throw new Error(
      `Cannot merge base target ${target} at ${entry.payload.version} with patch version ${patchVersion}`,
    );
  }
}

const manifests = [...byTarget.values()].sort((left, right) => {
  const leftPayload = JSON.parse(Buffer.from(left.payload, 'base64url').toString('utf8'));
  const rightPayload = JSON.parse(Buffer.from(right.payload, 'base64url').toString('utf8'));
  const leftKey = `${leftPayload.artifact.platform}:${leftPayload.artifact.arch}:${leftPayload.artifact.variant}`;
  const rightKey = `${rightPayload.artifact.platform}:${rightPayload.artifact.arch}:${rightPayload.artifact.variant}`;
  return leftKey.localeCompare(rightKey);
});

await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, manifests }, null, 2)}\n`);
