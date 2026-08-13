import { extractFile } from '@electron/asar';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const [expectedVersion] = process.argv.slice(2);

if (!expectedVersion) {
  throw new Error('Expected exactly one version argument');
}

async function findAppArchives(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const archives = await Promise.all(
    entries.map(async entry => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findAppArchives(entryPath);
      return entry.isFile() && entry.name === 'app.asar' ? [entryPath] : [];
    }),
  );

  return archives.flat();
}

const archives = await findAppArchives(path.resolve('release'));
if (archives.length !== 1) {
  throw new Error(`Expected one packaged app.asar, found ${archives.length}`);
}

const packageJson = JSON.parse((await extractFile(archives[0], 'package.json')).toString('utf8'));
if (packageJson.version !== expectedVersion) {
  throw new Error(
    `Packaged app version mismatch: expected ${expectedVersion}, found ${packageJson.version}`,
  );
}

console.log(`[PackageVersion] verified ${packageJson.version} in ${archives[0]}`);
