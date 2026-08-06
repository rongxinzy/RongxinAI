import fs from 'node:fs/promises';
import path from 'node:path';

const [outputPath, generation] = process.argv.slice(2);
if (!outputPath || !generation) {
  throw new Error(
    'usage: create-update-generation-pointer.mjs <output> <opaque-generation>',
  );
}
if (!/^[A-Za-z0-9._-]+$/.test(generation)) {
  throw new Error('Generation must be an opaque identifier without path separators');
}
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  `${JSON.stringify({ schemaVersion: 1, generation }, null, 2)}\n`,
);
