import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  expectedDebVersion,
  fingerprintArtifacts,
  installedExecutable,
  releaseArtifacts,
  releaseIdentity,
  verifyEvidence,
} from './linux-release-acceptance-lib.mjs';

const mode = process.argv[2];
if (!['accept', 'verify'].includes(mode)) {
  throw new Error('usage: linux-release-acceptance.mjs <accept|verify>');
}
const identity = releaseIdentity(process.env);
const directory = path.resolve('release');
const evidenceDirectory = path.join(directory, 'linux-release-acceptance');
const evidencePath = path.join(evidenceDirectory, 'evidence.json');
const artifacts = await releaseArtifacts(directory);

function run(command, args, capture = false) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    // Renderer budgets include startup, target discovery, content, screenshot and group cleanup.
    timeout: command === process.execPath ? 300_000 : 180_000,
  })?.trim();
}

if (mode === 'verify') {
  const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
  verifyEvidence(evidence, identity, await fingerprintArtifacts(artifacts));
} else {
  await fs.mkdir(evidenceDirectory, { recursive: true });
  await fs.rm(evidencePath, { force: true });
  // Exercise the delivered AppImage through FUSE. Extraction is not equivalent acceptance.
  if (process.env.APPIMAGE_EXTRACT_AND_RUN || process.env.APPIMAGE_EXTRACT_ONLY) {
    throw new Error('AppImage extraction overrides are forbidden during release acceptance');
  }
  await fs.access('/dev/fuse', constants.R_OK | constants.W_OK);
  const fingerprints = await fingerprintArtifacts(artifacts);
  const debVersion = run('dpkg-deb', ['-f', artifacts.deb, 'Version'], true);
  if (debVersion !== expectedDebVersion(identity.version)) {
    throw new Error(`Final deb version does not match release: ${debVersion}`);
  }
  const packageName = run('dpkg-deb', ['-f', artifacts.deb, 'Package'], true);
  if (!/^[a-z0-9][a-z0-9+.-]+$/.test(packageName)) {
    throw new Error('Final deb has an invalid package name');
  }
  run('sudo', ['apt-get', 'install', '-y', artifacts.deb]);
  const installedVersion = run('dpkg-query', ['-W', '-f=${Version}', packageName], true);
  if (installedVersion !== debVersion) throw new Error('Installed deb version mismatch');
  const builder = JSON.parse(await fs.readFile('electron-builder.json', 'utf8'));
  const installedFiles = run('dpkg-query', ['-L', packageName], true).split('\n');
  const executable = installedExecutable(installedFiles, builder.executableName);
  await fs.access(executable, constants.X_OK);
  run(process.execPath, [
    'scripts/verify-linux-renderer.mjs',
    executable,
    path.join(evidenceDirectory, 'deb.png'),
  ]);
  await fs.chmod(artifacts.appimage, 0o755);
  run(process.execPath, [
    'scripts/verify-linux-renderer.mjs',
    artifacts.appimage,
    path.join(evidenceDirectory, 'appimage.png'),
  ]);
  const evidence = {
    schemaVersion: 1,
    status: 'passed',
    identity,
    artifacts: Object.fromEntries(
      Object.entries(fingerprints).map(([format, artifact]) => [
        format,
        { ...artifact, renderer: 'passed' },
      ]),
    ),
  };
  verifyEvidence(evidence, identity, await fingerprintArtifacts(artifacts));
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(`[LinuxReleaseAcceptance] ${mode} passed for ${identity.edition}`);
