import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { verifyWindowsCompressedLlamaCppBundled } from './verify-windows-packaged-components.cjs';
const require = createRequire(import.meta.url);
const bundledSevenZipPath = require('7zip-bin').path7za as string;
const directories: string[] = [];
const hash = (bytes: Buffer | string) => crypto.createHash('sha256').update(bytes).digest('hex');
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-component-'));
  directories.push(root);
  const sevenZipPath = path.join(root, process.platform === 'win32' ? '7za.exe' : '7za');
  fs.copyFileSync(bundledSevenZipPath, sevenZipPath);
  if (process.platform !== 'win32') fs.chmodSync(sevenZipPath, 0o755);
  const staging = path.join(root, 'staging');
  const component = path.join(staging, 'llamacpp-bundled');
  const components = path.join(root, 'build-tar', 'windows-components');
  fs.mkdirSync(component, { recursive: true });
  fs.mkdirSync(components, { recursive: true });
  const binary = 'MZfixture-local-inference';
  const runtimeManifest = JSON.stringify({ executable: 'llama-server.exe', sha256: hash(binary) });
  fs.writeFileSync(path.join(component, 'llama-server.exe'), binary);
  fs.writeFileSync(path.join(component, 'manifest.json'), runtimeManifest);
  const archive = path.join(components, 'llamacpp-bundled.7z');
  const packed = spawnSync(sevenZipPath, ['a', '-t7z', archive, 'llamacpp-bundled'], {
    cwd: staging,
    encoding: 'utf8',
  });
  expect(packed.status, packed.error?.message || packed.stderr || packed.stdout).toBe(0);
  const manifest = {
    archive: 'llamacpp-bundled.7z',
    prefix: 'llamacpp-bundled',
    archiveSha256: hash(fs.readFileSync(archive)),
    sentinelSha256: hash(runtimeManifest),
  };
  const manifestPath = path.join(components, 'llamacpp-bundled.manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const context = {
    electronPlatformName: 'win32',
    arch: 1,
    appOutDir: path.join(root, 'release', 'win-unpacked'),
    packager: { projectDir: root },
  };
  return { context, archive, manifest, manifestPath, sevenZipPath };
}
test('retains real archive extraction and binary digest verification for local inference', () => {
  const f = fixture();
  expect(() =>
    verifyWindowsCompressedLlamaCppBundled(f.context, { sevenZipPath: f.sevenZipPath }),
  ).not.toThrow();
  fs.appendFileSync(f.archive, 'corrupt');
  expect(() =>
    verifyWindowsCompressedLlamaCppBundled(f.context, { sevenZipPath: f.sevenZipPath }),
  ).toThrow('archive SHA-256 mismatch');
});
test('rejects mismatched manifest sentinels inside a valid compressed component', () => {
  const f = fixture();
  fs.writeFileSync(
    f.manifestPath,
    JSON.stringify({ ...f.manifest, sentinelSha256: 'f'.repeat(64) }),
  );
  expect(() =>
    verifyWindowsCompressedLlamaCppBundled(f.context, { sevenZipPath: f.sevenZipPath }),
  ).toThrow('manifest SHA-256 mismatch');
});
