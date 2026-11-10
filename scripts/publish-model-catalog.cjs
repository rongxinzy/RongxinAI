const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const [input, directory, previousInput] = process.argv.slice(2);
const MAX_UPDATE_BYTES = 8 * 1024 * 1024;
if (!input || !directory) {
  throw new Error(
    'Usage: bun run scripts/publish-model-catalog.cjs <snapshot.json|catalog.sqlite> <output-dir> [previous-snapshot]',
  );
}

function readSnapshot(filePath) {
  let value;
  if (filePath.endsWith('.sqlite')) {
    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
      value = {
        ...db.prepare('SELECT revision, updated_at AS updatedAt FROM catalog_version').get(),
        models: db
          .prepare('SELECT payload FROM catalog_models ORDER BY position, repo_id')
          .all()
          .map(row => JSON.parse(row.payload)),
      };
    } finally {
      db.close();
    }
  } else {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  if (
    !Number.isSafeInteger(value.revision) ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.models) ||
    !value.models.length ||
    value.models.length > 5000
  ) {
    throw new Error(`Invalid catalog snapshot: ${filePath}`);
  }
  const models = new Map();
  for (const [position, model] of value.models.entries()) {
    const id = model.repoId?.toLowerCase();
    if (!id || models.has(id)) throw new Error(`Duplicate or missing catalog model ID: ${id}`);
    models.set(id, { position, model });
  }
  return { revision: value.revision, updatedAt: value.updatedAt, models };
}

function writeAtomic(name, data) {
  const file = path.join(directory, name);
  const staged = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(staged, data);
  fs.renameSync(staged, file);
}

const current = readSnapshot(input);
const previous = previousInput ? readSnapshot(previousInput) : null;
if (previous && previous.revision >= current.revision)
  throw new Error('Catalog revision must increase');
fs.mkdirSync(directory, { recursive: true });

function publish(baseRevision, upserts, deletes) {
  const name =
    baseRevision === null
      ? `snapshot-${current.revision}.json`
      : `delta-${baseRevision}-${current.revision}.json`;
  const data = JSON.stringify({
    baseRevision,
    revision: current.revision,
    updatedAt: current.updatedAt,
    upserts,
    deletes,
  });
  if (Buffer.byteLength(data) > MAX_UPDATE_BYTES) {
    throw new Error(`Catalog artifact exceeds the desktop size limit: ${name}`);
  }
  writeAtomic(name, data);
  return {
    bytes: Buffer.byteLength(data),
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

const manifest = {
  schema: 1,
  revision: current.revision,
  snapshot: publish(null, [...current.models.values()], []),
};
if (previous) {
  const upserts = [...current.models]
    .filter(([id, item]) => JSON.stringify(item) !== JSON.stringify(previous.models.get(id)))
    .map(([, item]) => item);
  const deletes = [...previous.models.keys()].filter(id => !current.models.has(id));
  manifest.delta = {
    baseRevision: previous.revision,
    ...publish(previous.revision, upserts, deletes),
  };
}

// Publish artifacts before the manifest so clients never see dangling references.
writeAtomic('manifest.json', JSON.stringify(manifest));
