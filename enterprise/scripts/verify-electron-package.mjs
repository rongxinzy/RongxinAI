import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.resolve(
  process.env.ZHIYUAN_ELECTRON_PACKAGE_DIR ??
    path.join(root, '..', 'zhiyuan-dev', 'dist', 'win-unpacked'),
);
const enterpriseRoot = path.join(packageRoot, 'resources', 'zhiyuan-enterprise');
const source = {
  extension: path.join(root, 'dist', 'extension.cjs'),
  renderer: path.join(root, 'dist', 'ui'),
  admin: path.join(root, 'dist', 'admin'),
  notices: path.join(root, 'THIRD_PARTY_NOTICES.md'),
  config: path.resolve(
    process.env.ZHIYUAN_ENTERPRISE_CONFIG_FILE ??
      path.join(root, 'build', 'enterprise-config.example.json'),
  ),
};

await assertDirectory(packageRoot, 'Electron package');
const checks = [
  await compareFile(
    source.extension,
    path.join(enterpriseRoot, 'extension.cjs'),
    'extension bundle',
  ),
  await compareFile(
    source.notices,
    path.join(enterpriseRoot, 'THIRD_PARTY_NOTICES.md'),
    'third-party notices',
  ),
  await compareFile(source.config, path.join(enterpriseRoot, 'config.json'), 'enterprise config'),
];
const sourceRenderer = await collectFiles(source.renderer);
const packagedRenderer = await collectFiles(path.join(enterpriseRoot, 'ui'));
assert.deepEqual(
  packagedRenderer.map(file => file.relative),
  sourceRenderer.filter(file => !file.relative.endsWith('.map')).map(file => file.relative),
  'Packaged Renderer files do not match the AaaS build output.',
);
for (const file of sourceRenderer.filter(file => !file.relative.endsWith('.map'))) {
  checks.push(
    await compareFile(
      path.join(source.renderer, file.relative),
      path.join(enterpriseRoot, 'ui', file.relative),
      `Renderer asset ${file.relative}`,
    ),
  );
}
const sourceAdmin = await collectFiles(source.admin);
const packagedAdmin = await collectFiles(path.join(enterpriseRoot, 'admin'));
assert.deepEqual(
  packagedAdmin.map(file => file.relative),
  sourceAdmin.filter(file => !file.relative.endsWith('.map')).map(file => file.relative),
  'Packaged Admin Console files do not match the AaaS build output.',
);
for (const file of sourceAdmin.filter(file => !file.relative.endsWith('.map'))) {
  checks.push(
    await compareFile(
      path.join(source.admin, file.relative),
      path.join(enterpriseRoot, 'admin', file.relative),
      `Admin asset ${file.relative}`,
    ),
  );
}

console.log(JSON.stringify({ status: 'passed', packageRoot, checks }, null, 2));

async function assertDirectory(directory, kind) {
  const stat = await fs.stat(directory);
  assert.ok(stat.isDirectory(), `${kind} directory is invalid: ${directory}`);
}

async function collectFiles(directory) {
  await assertDirectory(directory, 'Renderer');
  const files = [];
  await walk(directory, directory, files);
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

async function walk(directory, base, files) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath, base, files);
    else if (entry.isFile()) files.push({ relative: path.relative(base, fullPath) });
  }
}

async function compareFile(expectedPath, actualPath, kind) {
  const [expected, actual] = await Promise.all([
    fs.readFile(expectedPath),
    fs.readFile(actualPath),
  ]);
  const expectedHash = hash(expected);
  const actualHash = hash(actual);
  assert.equal(actualHash, expectedHash, `${kind} hash mismatch.`);
  return { kind, bytes: actual.byteLength, sha256: actualHash };
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
