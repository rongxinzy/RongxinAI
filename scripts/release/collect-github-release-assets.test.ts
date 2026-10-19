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

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'github-assets-'));
  const candidateRoot = path.join(root, 'candidate');
  const destination = path.join(root, 'assets');
  for (const edition of editions) {
    const target = `win32-x64-${edition}`;
    const bundle = path.join(candidateRoot, target);
    mkdirSync(path.join(bundle, 'payload', target), { recursive: true });
    const artifacts = kinds.map((kind, index) => {
      const filename = filenames[index];
      const relativePath = `payload/${target}/${filename}`;
      const bytes = Buffer.from(`${edition} ${kind} verified bytes`);
      writeFileSync(path.join(bundle, relativePath), bytes);
      return {
        platform: 'win32', arch: 'x64', variant: edition, kind, filename, relativePath,
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
  ], { encoding: 'utf8', env: { ...process.env, ZHIYUAN_RELEASE_PLATFORMS: 'win32' } });
  return { root, candidateRoot, destination, run };
}

test('keeps all three same-named edition installers and updaters byte-for-byte', () => {
  const f = fixture();
  try {
    const result = f.run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readdirSync(f.destination)).toHaveLength(6);
    for (const edition of editions) {
      for (const [index, kind] of kinds.slice(0, 2).entries()) {
        expect(readFileSync(path.join(f.destination, `win32-x64-${edition}-${filenames[index]}`), 'utf8'))
          .toBe(`${edition} ${kind} verified bytes`);
      }
    }
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
