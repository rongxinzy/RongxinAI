import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

const version = '2026.10.19-build.12';
const commit = 'a'.repeat(40);
const runId = '123';
const editions = ['lite', 'cpu', 'cuda'];
const kinds = ['installer', 'updater', 'blockmap', 'metadata'];
const filenames = ['installer.exe', 'Setup.exe', 'Setup.exe.blockmap', 'latest.yml'];

function webSetupBytes() {
  const bytes = Buffer.alloc(560);
  const peOffset = 128;
  const optionalOffset = peOffset + 24;
  bytes.write('MZ');
  bytes.writeUInt32LE(peOffset, 60);
  bytes.writeUInt32LE(0x4550, peOffset);
  bytes.writeUInt16LE(0x8664, peOffset + 4);
  bytes.writeUInt16LE(1, peOffset + 6);
  bytes.writeUInt16LE(240, peOffset + 20);
  bytes.writeUInt16LE(0x20b, optionalOffset);
  bytes.writeUInt32LE(16, optionalOffset + 108);
  bytes.writeUInt32LE(0x06054b50, 512);
  bytes.writeBigUInt64LE(512n, 536);
  bytes.writeBigUInt64LE(22n, 544);
  bytes.writeUInt32LE(24, 552);
  bytes.write('ZYP2', 556);
  return bytes;
}

function fixture(platform = 'win32') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'github-assets-'));
  const candidateRoot = path.join(root, 'candidate');
  const destination = path.join(root, 'assets');
  const targets = platform === 'win32'
    ? editions.map(edition => ({ arch: 'x64', edition }))
    : ['x64', 'arm64'].map(arch => ({ arch, edition: 'cpu' }));
  const artifactNames = platform === 'win32'
    ? filenames
    : ['installer.dmg', 'updater.zip', 'updater.zip.blockmap', 'latest-mac.yml'];
  for (const { arch, edition } of targets) {
    const target = `${platform}-${arch}-${edition}`;
    const bundle = path.join(candidateRoot, target);
    mkdirSync(path.join(bundle, 'payload', target), { recursive: true });
    const artifacts = kinds.map((kind, index) => {
      const filename = artifactNames[index];
      const relativePath = `payload/${target}/${filename}`;
      const bytes = kind === 'installer' ? webSetupBytes() : Buffer.from(`${edition} ${kind} verified bytes`);
      writeFileSync(path.join(bundle, relativePath), bytes);
      return {
        platform, arch, variant: edition, kind, filename, relativePath,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sha512: createHash('sha512').update(bytes).digest('base64'),
      };
    });
    writeFileSync(path.join(bundle, `candidate-${target}.json`), JSON.stringify({
      schemaVersion: 1, releaseVersion: version, sourceCommit: commit, candidateRunId: runId, artifacts,
    }));
    writeFileSync(path.join(bundle, 'diagnostic.txt'), 'must not ship');
  }
  const run = () => spawnSync(process.execPath, [
    'scripts/release/collect-github-release-assets.mjs', version, commit, runId, candidateRoot, destination,
  ], { encoding: 'utf8', env: { ...process.env, ZHIYUAN_RELEASE_PLATFORM: platform } });
  return { root, candidateRoot, destination, run };
}

test('publishes each Windows WebView2 installer and excludes NSIS automatic updaters', () => {
  const f = fixture();
  try {
    const result = f.run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readdirSync(f.destination)).toHaveLength(3);
    for (const edition of editions) {
      expect(readFileSync(path.join(f.destination, `win32-x64-${edition}-${filenames[0]}`)))
        .toEqual(webSetupBytes());
      expect(readdirSync(f.destination)).not.toContain(`win32-x64-${edition}-${filenames[1]}`);
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('retains macOS DMG installers and ZIP update archives for both architectures', () => {
  const f = fixture('darwin');
  try {
    const result = f.run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readdirSync(f.destination).sort()).toEqual([
      'darwin-arm64-cpu-installer.dmg',
      'darwin-arm64-cpu-updater.zip',
      'darwin-x64-cpu-installer.dmg',
      'darwin-x64-cpu-updater.zip',
    ]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects a renamed native executable even when its candidate hashes match', () => {
  const f = fixture();
  try {
    const bundle = path.join(f.candidateRoot, 'win32-x64-lite');
    const manifestPath = path.join(bundle, 'candidate-win32-x64-lite.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const artifact = manifest.artifacts[0];
    const bytes = webSetupBytes();
    bytes.fill(0, 512);
    writeFileSync(path.join(bundle, artifact.relativePath), bytes);
    artifact.sha256 = createHash('sha256').update(bytes).digest('hex');
    artifact.sha512 = createHash('sha512').update(bytes).digest('base64');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Missing ZYP2 setup payload footer');
    expect(readdirSync(f.root)).not.toContain('assets');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects a corrupted candidate before staging any release assets', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.candidateRoot, 'win32-x64-cpu/payload/win32-x64-cpu/Setup.exe'), 'wrong edition');
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('bytes do not match');
    expect(readdirSync(f.root)).not.toContain('assets');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects stale destination assets instead of uploading them with this release', () => {
  const f = fixture();
  try {
    mkdirSync(f.destination);
    writeFileSync(path.join(f.destination, 'old.exe'), 'old release');
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('destination must be empty');
    expect(readdirSync(f.destination)).toEqual(['old.exe']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
