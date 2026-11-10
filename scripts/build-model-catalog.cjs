const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const input = process.argv[2];
if (!input) throw new Error('Pass the verified catalog snapshot JSON path');
const snapshot = JSON.parse(fs.readFileSync(input, 'utf8'));
const destination = path.join(root, 'resources', 'model-catalog.sqlite');
const staged = `${destination}.tmp`;
if (!Number.isSafeInteger(snapshot.revision) || !snapshot.updatedAt || !snapshot.models?.length) {
  throw new Error('Missing model catalog revision or models');
}
fs.rmSync(staged, { force: true });
const db = new DatabaseSync(staged);
try {
  db.exec(`
    CREATE TABLE catalog_version (revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE catalog_models (
      repo_id TEXT PRIMARY KEY COLLATE NOCASE,
      position INTEGER NOT NULL,
      payload TEXT NOT NULL CHECK (json_valid(payload)),
      search_text TEXT NOT NULL,
      tags TEXT NOT NULL CHECK (json_valid(tags)),
      parameter_count REAL,
      featured_rank INTEGER
    );
    CREATE INDEX catalog_models_position ON catalog_models (position, repo_id);
    BEGIN;
  `);
  db.prepare('INSERT INTO catalog_version VALUES (?, ?)').run(
    snapshot.revision,
    snapshot.updatedAt,
  );
  const insert = db.prepare('INSERT INTO catalog_models VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [position, model] of snapshot.models.entries()) {
    if (!/^[a-z0-9_-][a-z0-9_.-]*\/[a-z0-9_-][a-z0-9_.-]*$/i.test(model.repoId)) {
      throw new Error(`Invalid ModelScope repository: ${model.repoId}`);
    }
    const files = model.files?.map(file => {
      const segments = file.path.split('/');
      if (
        !file.path.toLowerCase().endsWith('.gguf') ||
        segments.some(
          segment => !segment || segment === '.' || segment === '..' || /[\\:*?"<>|]/.test(segment),
        ) ||
        !/^[a-f0-9]{40}$/i.test(file.revision) ||
        !/^[a-f0-9]{64}$/i.test(file.sha256) ||
        !Number.isSafeInteger(file.sizeBytes) ||
        file.sizeBytes < 1
      ) {
        throw new Error(`Unverified ModelScope file for ${model.repoId}: ${file.path}`);
      }
      return {
        ...file,
        downloadUrl: `https://www.modelscope.cn/models/${model.repoId}/resolve/${file.revision}/${segments.map(encodeURIComponent).join('/')}`,
      };
    });
    if (!files?.some(file => file.isRecommended && file.kind !== 'mmproj')) {
      throw new Error(`No checksum-backed recommended model file for ${model.repoId}`);
    }
    insert.run(
      model.repoId,
      position,
      JSON.stringify({ ...model, files, installed: false }),
      [model.repoId, model.name, model.description, ...model.tags, model.recommendedTag].join(' '),
      JSON.stringify(
        [...model.tags, ...(model.capabilities ?? [model.capability])].map(tag =>
          tag.toLowerCase(),
        ),
      ),
      model.parameterCount ?? null,
      model.isFeatured ? (model.featuredRank ?? position) : null,
    );
  }
  db.exec('COMMIT');
} finally {
  db.close();
}
fs.renameSync(staged, destination);
