import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  retainedHostPath,
  resetRetainedHost,
  captureUninstaller,
  verifyRetainedHost,
} = require('./retain-uninstaller.cjs');
const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-native-host-'));
  roots.push(root);
  for (const args of [
    ['init', '-q'],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'fixture',
    ],
  ]) {
    const git = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    expect(git.status, git.stderr).toBe(0);
  }
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '2026.7.16' }));
  writeFileSync(
    path.join(root, 'electron-builder.json'),
    JSON.stringify({
      appId: 'com.zhiyuanagent.app',
      productName: 'Fixture',
      nsis: { artifactName: '${productName}-Setup-${version}.${ext}' },
    }),
  );
  mkdirSync(path.join(root, 'release'));
  const source = path.join(root, 'release', 'Fixture-Setup-2026.7.16.__uninstaller.exe');
  const bytes = Buffer.alloc(1152, 0);
  bytes.write('MZ');
  bytes.writeUInt32LE(128, 60);
  bytes.writeUInt32LE(0x4550, 128);
  bytes.writeUInt16LE(0x14c, 132);
  bytes.writeUInt16LE(1, 134);
  bytes.writeUInt16LE(224, 148);
  bytes.writeUInt16LE(0x10b, 152);
  bytes.writeUInt32LE(512, 376 + 16);
  bytes.writeUInt32LE(512, 376 + 20);
  bytes.writeUInt32LE(0xdeadbeef, 1028);
  bytes.write('NullsoftInst', 1032);
  // Opaque trailing bytes model the byte-for-byte retention requirement only;
  // trusted Authenticode is exercised separately on Windows release runners.
  bytes.fill(0xa7, 1080);
  writeFileSync(source, bytes);
  return { root, source, bytes };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('retains exactly the native host bytes and binds its current source commit', () => {
  const { root, source, bytes } = fixture();
  const manifest = captureUninstaller(root, source);
  expect(manifest.kind).toBe('nsis-uninstall-host');
  expect(manifest.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
  expect(manifest.sourceSha256).toBe(manifest.sha256);
  expect(manifest.bytes).toBe(bytes.length);
  expect(readFileSync(retainedHostPath(root))).toEqual(bytes);
  expect(verifyRetainedHost(root)).toEqual(manifest);
});

test('rejects a different intermediate source, including an older version', () => {
  const { root, source, bytes } = fixture();
  const stale = source.replace('2026.7.16', '2026.7.15');
  writeFileSync(stale, bytes);
  expect(() => captureUninstaller(root, stale)).toThrow(/exact UNINSTALLER_OUT_FILE/);
});

test('rejects a managed shell or invalid native executable', () => {
  const { root, source, bytes } = fixture();
  bytes.fill(0, 1028, 1044);
  writeFileSync(source, bytes);
  expect(() => captureUninstaller(root, source)).toThrow(/native NSIS/);
});

test.each(['bytes', 'sourceSha256', 'sourceCommit', 'version', 'sourceFileName'])(
  'rejects retained manifest mismatch in %s',
  key => {
    const { root, source } = fixture();
    const manifest = captureUninstaller(root, source);
    manifest[key] = key === 'bytes' ? manifest.bytes + 1 : 'stale';
    writeFileSync(`${retainedHostPath(root)}.manifest.json`, JSON.stringify(manifest));
    expect(() => verifyRetainedHost(root)).toThrow(/do not match/);
  },
);

test('rejects changed output bytes and clears both stale files at the next NSIS build', () => {
  const { root, source, bytes } = fixture();
  captureUninstaller(root, source);
  bytes[1100] ^= 1;
  writeFileSync(retainedHostPath(root), bytes);
  expect(() => verifyRetainedHost(root)).toThrow(/do not match/);
  resetRetainedHost(root);
  expect(existsSync(retainedHostPath(root))).toBe(false);
  expect(existsSync(`${retainedHostPath(root)}.manifest.json`)).toBe(false);
  expect(() => verifyRetainedHost(root)).toThrow();
});
