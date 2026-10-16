import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..', '..');
const { packagingExcludePatterns } = require(
  path.join(root, 'scripts/packaging/assert-package-contents.cjs'),
);
const configPath = path.join(root, 'electron-builder.enterprise.cjs');

const ENV_KEYS = [
  'ZHIYUAN_ENTERPRISE_EXTENSION_BUNDLE',
  'ZHIYUAN_ENTERPRISE_RENDERER_DIRECTORY',
  'ZHIYUAN_ENTERPRISE_NOTICE_FILE',
  'ZHIYUAN_ENTERPRISE_CONFIG_FILE',
  'CERTUM_CERT_THUMBPRINT',
];

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'enterprise-builder-config-'));
const fixture = {
  bundle: path.join(temporaryDirectory, 'extension.cjs'),
  renderer: path.join(temporaryDirectory, 'ui'),
  notices: path.join(temporaryDirectory, 'THIRD_PARTY_NOTICES.md'),
  config: path.join(temporaryDirectory, 'config.json'),
};
fs.writeFileSync(fixture.bundle, '// enterprise extension bundle');
fs.mkdirSync(fixture.renderer);
fs.writeFileSync(path.join(fixture.renderer, 'index.html'), '<html></html>');
fs.writeFileSync(fixture.notices, 'notices');
fs.writeFileSync(fixture.config, '{"schemaVersion":1}');

function loadConfig(env) {
  const saved = new Map(ENV_KEYS.map(key => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  delete require.cache[configPath];
  try {
    return require(configPath);
  } finally {
    delete require.cache[configPath];
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function fixtureEnv() {
  return {
    ZHIYUAN_ENTERPRISE_EXTENSION_BUNDLE: fixture.bundle,
    ZHIYUAN_ENTERPRISE_RENDERER_DIRECTORY: fixture.renderer,
    ZHIYUAN_ENTERPRISE_NOTICE_FILE: fixture.notices,
    ZHIYUAN_ENTERPRISE_CONFIG_FILE: fixture.config,
  };
}

try {
  const base = require(path.join(root, 'electron-builder.json'));

  const unsigned = loadConfig(fixtureEnv());
  assert.equal(unsigned.productName, '知远企业版');
  assert.equal(unsigned.executableName, '知远企业版');
  assert.equal(unsigned.appId, 'com.zhiyuanagent.enterprise');
  assert.deepEqual(unsigned.protocols, []);
  assert.equal(unsigned.win.signtoolOptions, undefined);
  assert.deepEqual(unsigned.win.signExts, base.win.signExts);
  assert.ok(unsigned.win.extraResources.length > 0, 'win extraResources must be preserved');

  const byTarget = new Map(unsigned.extraResources.map(entry => [entry.to, entry]));
  for (const entry of base.extraResources) {
    assert.ok(byTarget.has(entry.to), `base extraResource is missing: ${entry.to}`);
  }
  assert.equal(byTarget.get('zhiyuan-enterprise/extension.cjs').from, fixture.bundle);
  assert.equal(byTarget.get('zhiyuan-enterprise/ui').from, fixture.renderer);
  assert.deepEqual(byTarget.get('zhiyuan-enterprise/ui').filter, [
    '**/*',
    ...packagingExcludePatterns(),
  ]);
  assert.equal(
    [...byTarget.keys()].some(target => String(target).includes('modelscope.tokens')),
    false,
  );
  assert.equal(byTarget.get('zhiyuan-enterprise/THIRD_PARTY_NOTICES.md').from, fixture.notices);
  assert.equal(byTarget.get('zhiyuan-enterprise/config.json').from, fixture.config);
  assert.ok(
    ![...byTarget.keys()].some(target => target.includes('admin')),
    'enterprise package must not bundle an admin console directory',
  );

  const signed = loadConfig({
    ...fixtureEnv(),
    CERTUM_CERT_THUMBPRINT: '  a1b2-c3d4 e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 ',
  });
  assert.deepEqual(signed.win.signtoolOptions, {
    certificateSha1: 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0',
    signingHashAlgorithms: ['sha256'],
    rfc3161TimeStampServer: 'http://time.certum.pl',
  });

  assert.throws(() => loadConfig({ ...fixtureEnv(), CERTUM_CERT_THUMBPRINT: 'not-a-thumbprint' }), {
    message: /CERTUM_CERT_THUMBPRINT must contain the 40-character SHA-1 thumbprint/,
  });

  const missing = path.join(temporaryDirectory, 'does-not-exist.cjs');
  assert.throws(
    () => loadConfig({ ...fixtureEnv(), ZHIYUAN_ENTERPRISE_EXTENSION_BUNDLE: missing }),
    error => {
      assert.match(error.message, /Enterprise package input is missing/);
      assert.match(error.message, /does-not-exist\.cjs/);
      assert.match(error.message, /ZHIYUAN_ENTERPRISE_EXTENSION_BUNDLE/);
      return true;
    },
  );

  console.log(
    JSON.stringify(
      {
        status: 'passed',
        checks: [
          'enterprise product identity overrides (productName, executableName, appId, protocols)',
          'base extraResources and win options preserved',
          'enterprise extraResources mapping honors env overrides',
          'signtoolOptions present only with a valid CERTUM_CERT_THUMBPRINT',
          'missing enterprise input fails with the path and the overriding env var',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
