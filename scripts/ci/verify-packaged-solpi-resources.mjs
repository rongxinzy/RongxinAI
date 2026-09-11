/**
 * Verifies that the vendored SoL-Pi extension ships inside the packaged app
 * and that its runtime dependencies resolve from the same archive:
 *
 *  - solpi-vendor/ tree (upstream TS + MIT license + notices + pin) is packed
 *    into app.asar next to node_modules, so jiti's node resolution finds the
 *    shared @earendil-works packages without a source checkout;
 *  - the Electron main bundle contains the packaged vendor candidate path;
 *  - jiti and the Pi SDK are packed as production dependencies.
 *
 * Reads the asar header directly (no extra tooling). Run against the release
 * output directory, like verify-packaged-acp-resources.mjs:
 *
 *   node scripts/ci/verify-packaged-solpi-resources.mjs [release]
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const [packageRootArgument = 'release'] = process.argv.slice(2);
const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const sourceVendorRoot = path.join(projectRoot, 'src', 'main', 'libs', 'solPi', 'vendor');

const REQUIRED_ENTRIES = [
  'solpi-vendor/sol-pi/index.ts',
  'solpi-vendor/LICENSE.MIT',
  'solpi-vendor/THIRD_PARTY_NOTICES.md',
  'solpi-vendor/UPSTREAM_COMMIT',
  'dist-electron/main.js',
  'node_modules/jiti/package.json',
  'node_modules/@earendil-works/pi-agent-core/package.json',
  'node_modules/@earendil-works/pi-ai/package.json',
  'node_modules/@earendil-works/pi-coding-agent/package.json',
  'node_modules/typebox/package.json',
];

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

/**
 * Parse an asar archive header. Layout (nested Pickle):
 * [u32 4][u32 headerSize][u32 paddedJsonSize][u32 jsonSize][json bytes], the
 * data section starts at 8 + headerSize and file offsets in the JSON are
 * relative to it.
 */
async function readAsar(archivePath) {
  const handle = await readFile(archivePath);
  const headerSize = handle.readUInt32LE(4);
  const jsonSize = handle.readUInt32LE(12);
  const header = JSON.parse(handle.subarray(16, 16 + jsonSize).toString('utf8'));
  const dataStart = 8 + headerSize;
  const files = new Map();
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const entryPath = prefix ? `${prefix}/${name}` : name;
      if (child.files) {
        walk(child, entryPath);
      } else {
        files.set(entryPath, {
          size: child.size,
          read: () => handle.subarray(dataStart + Number(child.offset), dataStart + Number(child.offset) + child.size),
        });
      }
    }
  };
  walk(header, '');
  return files;
}

const archives = await findAppArchives(path.resolve(packageRootArgument));
if (archives.length !== 1) {
  throw new Error(`Expected one packaged app.asar, found ${archives.length}`);
}

const archivePath = archives[0];
const files = await readAsar(archivePath);
const missing = REQUIRED_ENTRIES.filter(entry => !files.has(entry));
if (missing.length > 0) {
  throw new Error(`Packaged app is missing SoL-Pi resources: ${missing.join(', ')}`);
}

// Attribution files must ship byte-identical to the reviewed vendor tree.
for (const attribution of ['LICENSE.MIT', 'THIRD_PARTY_NOTICES.md', 'UPSTREAM_COMMIT']) {
  const packaged = files.get(`solpi-vendor/${attribution}`).read();
  const source = await readFile(path.join(sourceVendorRoot, attribution));
  if (!packaged.equals(source)) {
    throw new Error(`Packaged solpi-vendor/${attribution} differs from the source tree`);
  }
}

// Every vendored upstream file must be packed.
const collectSourceFiles = async directory => {
  const entries = await readdir(directory, {
    withFileTypes: true,
    recursive: true,
  });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)));
};
const sourceFiles = (await collectSourceFiles(sourceVendorRoot)).map(entry =>
  entry.split(path.sep).join('/'),
).sort();
const packagedVendorFiles = [...files.keys()]
  .filter(entry => entry.startsWith('solpi-vendor/'))
  .map(entry => entry.slice('solpi-vendor/'.length))
  .sort();
if (JSON.stringify(sourceFiles) !== JSON.stringify(packagedVendorFiles)) {
  throw new Error(
    `Packaged solpi-vendor tree differs from the source tree:\nsource: ${sourceFiles.join(', ')}\npackaged: ${packagedVendorFiles.join(', ')}`,
  );
}

// The main bundle must embed the packaged candidate so the runtime loader can
// resolve the vendor without a source checkout.
const mainBundle = files.get('dist-electron/main.js').read().toString('utf8');
if (!mainBundle.includes('solpi-vendor/sol-pi/index.ts')) {
  throw new Error('Electron main bundle does not reference the packaged solpi-vendor entry');
}

console.log(
  `[PackagedSolPi] verified ${packagedVendorFiles.length} vendored files, attribution, loader wiring and runtime deps in ${archivePath}`,
);
