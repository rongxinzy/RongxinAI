import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import { packageCommands } from '../scripts/packaging/package-commands.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('protected Windows releases authenticate with Certum and require valid signatures', () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  for (const name of ['dist:win:signed', 'dist:win:offline'])
    assert.equal(packageJson.scripts[name], `bun scripts/packaging/run-package.mjs ${name}`);
  assert.match(packageCommands['dist:win:signed'], /electron-builder\.windows-signed\.cjs/);
  assert.match(packageCommands['dist:win:offline'], /electron-builder\.json/);

  const releaseWorkflow = readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(releaseWorkflow, /uses: \.\/\.github\/workflows\/build-inference-editions\.yml/);
  assert.match(releaseWorkflow, /CERTUM_CERT_THUMBPRINT:/);
  const buildWorkflow = readFileSync(
    path.join(root, '.github/workflows/build-inference-editions.yml'),
    'utf8',
  );
  assert.match(buildWorkflow, /\.\/\.github\/actions\/setup-certum-signing/);
  assert.match(buildWorkflow, /bun run dist:win:signed/);
  assert.match(buildWorkflow, /verify-windows-authenticode\.ps1/);
  const setupAction = readFileSync(
    path.join(root, '.github/actions/setup-certum-signing/action.yml'),
    'utf8',
  );
  assert.match(setupAction, /dismine\/windows-app-signing-setup-action@[0-9a-f]{40}/);
  assert.match(setupAction, /SimplySignDesktop-9\.4\.3\.90-64-bit-en\.msi/);
  assert.match(setupAction, /SignerCertificate\.Subject[\s\S]*Asseco Data Systems/);
  assert.match(setupAction, /capture-diagnostics: false/);
  const signedConfig = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        'const c=require(process.argv[1]); process.stdout.write(JSON.stringify(c.win.signtoolOptions));',
        path.join(root, 'electron-builder.windows-signed.cjs'),
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, CERTUM_CERT_THUMBPRINT: '0123456789abcdef0123456789abcdef01234567' },
      },
    ),
  ) as {
    certificateSha1: string;
    signingHashAlgorithms: string[];
    rfc3161TimeStampServer: string;
  };
  assert.equal(signedConfig.certificateSha1, '0123456789ABCDEF0123456789ABCDEF01234567');
  assert.deepEqual(signedConfig.signingHashAlgorithms, ['sha256']);
  assert.equal(signedConfig.rfc3161TimeStampServer, 'http://time.certum.pl');
  const signatureVerifier = readFileSync(
    path.join(root, 'scripts/ci/verify-windows-authenticode.ps1'),
    'utf8',
  );
  assert.match(
    signatureVerifier,
    /electron-builder\.json'[\s\S]*-Raw -Encoding UTF8 \| ConvertFrom-Json/,
  );
});
