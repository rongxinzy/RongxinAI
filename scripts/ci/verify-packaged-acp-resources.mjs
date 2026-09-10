import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const [packageRootArgument = 'release'] = process.argv.slice(2);
const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const sourceRegistryPath = path.join(projectRoot, 'resources', 'acp', 'registry.json');

const BUNDLED_ADAPTERS = [
  { packageName: '@agentclientprotocol/codex-acp', binName: 'codex-acp' },
  { packageName: '@agentclientprotocol/claude-agent-acp', binName: 'claude-agent-acp' },
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

function packageBinEntry(manifest, binName) {
  if (typeof manifest.bin === 'string') return manifest.bin;
  if (!manifest.bin || typeof manifest.bin !== 'object') return null;
  const entry = manifest.bin[binName];
  return typeof entry === 'string' ? entry : null;
}

const archives = await findAppArchives(path.resolve(packageRootArgument));
if (archives.length !== 1) {
  throw new Error(`Expected one packaged app.asar, found ${archives.length}`);
}

const archivePath = archives[0];
const resourcesPath = path.dirname(archivePath);
const [sourceRegistry, packagedRegistry] = await Promise.all([
  readFile(sourceRegistryPath),
  readFile(path.join(resourcesPath, 'acp', 'registry.json')),
]);
if (!sourceRegistry.equals(packagedRegistry)) {
  throw new Error('Packaged ACP registry differs from resources/acp/registry.json');
}

const snapshot = JSON.parse(packagedRegistry.toString('utf8'));
if (!Array.isArray(snapshot.agents) || snapshot.agents.length !== 39) {
  throw new Error('Packaged ACP registry must contain exactly 39 agents');
}
if (new Set(snapshot.agents.map(agent => agent?.id)).size !== snapshot.agents.length) {
  throw new Error('Packaged ACP registry contains duplicate agent IDs');
}

for (const adapter of BUNDLED_ADAPTERS) {
  const packageRoot = path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    adapter.packageName,
  );
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const entry = packageBinEntry(manifest, adapter.binName);
  if (!entry) {
    throw new Error(`Packaged ${adapter.packageName} does not declare ${adapter.binName}`);
  }
  await access(path.resolve(packageRoot, entry));
}

console.log(`[PackagedAcp] verified registry and bundled bridges in ${resourcesPath}`);
