import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { upstream } = require('../magpie-runtime.cjs');

const MAC_TARGETS = ['darwin-x64', 'darwin-arm64'];

export function assertDeveloperIdHardenedRuntime(info) {
  if (!info.includes('Authority=Developer ID Application:')) {
    throw new Error('Magpie macOS signature is not a Developer ID Application certificate');
  }
  if (!/flags=.*\bruntime\b/.test(info)) {
    throw new Error('Magpie macOS signature does not enable the hardened runtime');
  }
}

export function assertSealedMagpieManifest(manifest, digest) {
  if (manifest.version !== upstream.version || manifest.source?.commit !== upstream.commit) {
    throw new Error('Packaged Magpie does not match the pinned upstream release');
  }
  if (manifest.sha256 !== digest) {
    throw new Error('Magpie SHA-256 does not match the sealed manifest');
  }
  if (manifest.buildSha256 === manifest.sha256) {
    throw new Error('Signed Magpie must keep the compiler digest distinct from the shipped digest');
  }
  if (manifest.signing?.platform !== 'darwin' || manifest.signing?.format !== 'codesign') {
    throw new Error('Signed Magpie manifest is missing the codesign seal');
  }
}

function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function codesignInfo(binary, spawn = spawnSync) {
  const result = spawn('codesign', ['-dv', '--verbose=4', binary], { encoding: 'utf8' });
  if (result.error) throw result.error;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0) throw new Error(`codesign failed for ${binary}: ${output}`);
  return output;
}

export function verifyPackagedMagpieApp(appPath, deps = {}) {
  const execFile = deps.execFile || execFileSync;
  const spawn = deps.spawn || spawnSync;
  if (!appPath || !fs.existsSync(appPath)) {
    throw new Error(`Packaged macOS app was not found: ${appPath || ''}`);
  }
  for (const key of MAC_TARGETS) {
    const directory = path.join(appPath, 'Contents', 'Resources', 'magpie', key);
    const binary = path.join(directory, 'magpie');
    if (!fs.statSync(binary).isFile()) {
      throw new Error(`Packaged Magpie binary is missing: ${binary}`);
    }
    execFile('codesign', ['--verify', '--strict', '--verbose=2', binary], { stdio: 'inherit' });
    assertDeveloperIdHardenedRuntime(codesignInfo(binary, spawn));
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    assertSealedMagpieManifest(manifest, sha256File(binary));
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    verifyPackagedMagpieApp(process.argv[2]);
    console.log(
      'Magpie helpers are Developer ID signed with the hardened runtime and match the sealed manifests.',
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
