const { statSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const MIN_MODELS = 100;
const MAX_BYTES = 100_000_000;

function assertModelCatalog(file) {
  const bytes = statSync(file).size;
  if (bytes > MAX_BYTES) throw new Error(`Model catalog exceeds 100 MB: ${bytes} bytes`);
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const { count } = database.prepare('SELECT count(*) AS count FROM catalog_models').get();
    if (count < MIN_MODELS) {
      throw new Error(
        `Model catalog must contain at least ${MIN_MODELS} repositories, found ${count}`,
      );
    }
    return { count, bytes };
  } finally {
    database.close();
  }
}

module.exports = { assertModelCatalog, MIN_MODELS };

if (require.main === module) {
  const { count, bytes } = assertModelCatalog(process.argv[2]);
  console.log(`[ModelCatalog] verified ${count} bundled repositories in ${bytes} bytes`);
}
