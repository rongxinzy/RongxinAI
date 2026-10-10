import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  await fs.readFile(path.join(root, 'build', 'build-manifest.json'), 'utf8'),
);
const inputs = {
  extensionBundle: resolveInput('ZHIYUAN_ENTERPRISE_EXTENSION_BUNDLE', 'dist/extension.cjs'),
  rendererDirectory: resolveInput('ZHIYUAN_ENTERPRISE_RENDERER_DIRECTORY', 'dist/ui'),
  adminDirectory: resolveInput('ZHIYUAN_ENTERPRISE_ADMIN_DIRECTORY', 'dist/admin'),
  noticeFile: resolveInput('ZHIYUAN_ENTERPRISE_NOTICE_FILE', 'THIRD_PARTY_NOTICES.md'),
  configFile: resolveInput(
    'ZHIYUAN_ENTERPRISE_CONFIG_FILE',
    'build/enterprise-config.example.json',
  ),
};

assert.match(manifest.zhiyuanCore?.commit ?? '', /^[0-9a-f]{40}$/);
assert.match(manifest.aepProtocol?.commit ?? '', /^[0-9a-f]{40}$/);
assert.match(manifest.aepSdk?.sha256 ?? '', /^[0-9a-f]{64}$/);

const files = [];
files.push(await inspectFile(inputs.extensionBundle, 'extension bundle'));
files.push(await inspectFile(inputs.noticeFile, 'third-party notices'));
const config = await inspectFile(inputs.configFile, 'enterprise config');
const configValue = JSON.parse(await fs.readFile(inputs.configFile, 'utf8'));
assert.deepEqual(Object.keys(configValue).sort(), [
  'aepBaseUrl',
  'allowInsecureHttp',
  'schemaVersion',
]);
assert.equal(configValue.schemaVersion, 1);
assert.match(configValue.aepBaseUrl, /^https?:\/\//);
assert.equal(typeof configValue.allowInsecureHttp, 'boolean');
files.push(config);

const rendererEntries = await fs.readdir(inputs.rendererDirectory, { withFileTypes: true });
assert.ok(rendererEntries.some(entry => entry.isFile() && entry.name === 'index.html'));
for (const entry of rendererEntries) {
  if (entry.isFile() && !entry.name.endsWith('.map')) {
    files.push(
      await inspectFile(path.join(inputs.rendererDirectory, entry.name), 'renderer asset'),
    );
  }
}

const adminEntries = await fs.readdir(inputs.adminDirectory, { withFileTypes: true });
assert.ok(adminEntries.some(entry => entry.isFile() && entry.name === 'index.html'));
for (const entry of adminEntries) {
  if (entry.isFile() && !entry.name.endsWith('.map')) {
    files.push(await inspectFile(path.join(inputs.adminDirectory, entry.name), 'admin asset'));
  }
}

console.log(
  JSON.stringify(
    {
      status: 'passed',
      inputs: files,
      pins: {
        zhiyuanCore: manifest.zhiyuanCore.commit,
        aepProtocol: manifest.aepProtocol.commit,
        aepSdkSha256: manifest.aepSdk.sha256,
      },
    },
    null,
    2,
  ),
);

function resolveInput(variable, fallback) {
  return path.resolve(process.env[variable] ?? path.join(root, fallback));
}

async function inspectFile(filePath, kind) {
  const stat = await fs.stat(filePath);
  assert.ok(stat.isFile(), `${kind} must be a file: ${filePath}`);
  const content = await fs.readFile(filePath);
  return {
    kind,
    path: path.relative(root, filePath) || path.basename(filePath),
    bytes: content.byteLength,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}
