import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

async function findPackagedRuntimes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = await Promise.all(
    entries.map(async entry => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findPackagedRuntimes(entryPath);
      const isRuntime =
        entry.isFile() &&
        path.basename(directory) === 'rtk-runtime' &&
        (entry.name === 'rtk' || entry.name === 'rtk.exe');
      return isRuntime ? [entryPath] : [];
    }),
  );
  return matches.flat();
}

const rootDirectory = path.resolve('release');
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const expectedVersion = packageJson.rtkRuntime?.version?.replace(/^v/, '');
if (!expectedVersion) throw new Error('package.json does not declare rtkRuntime.version.');

const runtimes = await findPackagedRuntimes(rootDirectory);
if (runtimes.length !== 1) {
  throw new Error(`Expected one packaged RTK runtime, found ${runtimes.length}.`);
}

const executablePath = runtimes[0];
const buildInfo = JSON.parse(
  await readFile(path.join(path.dirname(executablePath), 'runtime-build-info.json'), 'utf8'),
);
if (
  buildInfo.version !== packageJson.rtkRuntime.version ||
  buildInfo.sourceRevision !== packageJson.rtkRuntime.sourceRevision
) {
  throw new Error('Packaged RTK provenance does not match package.json.');
}

const result = spawnSync(executablePath, ['--version'], {
  encoding: 'utf8',
  timeout: 10_000,
  windowsHide: true,
});
if (result.error || result.status !== 0) {
  throw new Error(
    `Packaged RTK runtime failed to start: ${result.error?.message || result.stderr}.`,
  );
}
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
if (!output.includes(expectedVersion)) {
  throw new Error(`Expected RTK ${expectedVersion}, received ${output.trim()}.`);
}

console.log(`[RtkRuntime] verified ${expectedVersion} in ${executablePath}`);
