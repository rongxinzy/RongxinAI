import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const bundleUrl = new URL('../dist/extension.cjs', import.meta.url);
const rendererDirectory = new URL('../dist/ui/', import.meta.url);
const rendererIndexUrl = new URL('index.html', rendererDirectory);
const bundleSource = await fs.readFile(bundleUrl, 'utf8');
assert.doesNotMatch(
  bundleSource,
  /require\(["']@aep\/sdk-node["']\)/,
  'Bundle must not require an external AEP SDK installation.',
);
const bundledModule = await import(bundleUrl);
const factory =
  bundledModule.createZhiyuanEnterpriseExtension ??
  bundledModule.default?.createZhiyuanEnterpriseExtension;

assert.equal(typeof factory, 'function', 'Bundle must export createZhiyuanEnterpriseExtension.');
const extension = await factory();
assert.equal(extension.apiVersion, 1, 'Bundle must implement enterprise extension API v1.');
assert.equal(extension.id, 'zhiyuan.aaas', 'Bundle must expose the stable extension ID.');

await extension.initialize({
  apiVersion: 1,
  appVersion: 'verification',
  isPackaged: true,
  platform: process.platform,
  paths: { resources: process.cwd(), userData: process.cwd() },
  capabilities: { session: null, renderer: null },
});
await extension.dispose();

const rendererIndex = await fs.readFile(rendererIndexUrl, 'utf8');
assert.match(rendererIndex, /<div id="root"><\/div>/, 'Renderer must contain its React root.');
const assetReferences = [...rendererIndex.matchAll(/(?:src|href)="\.\/([^"?]+)"/g)].map(
  match => match[1],
);
assert.ok(assetReferences.length >= 2, 'Renderer must reference bundled JavaScript and CSS.');
for (const assetReference of assetReferences) {
  await fs.access(new URL(assetReference, rendererDirectory));
  assert.doesNotMatch(assetReference, /\.map$/, 'Renderer must not load source maps.');
}
