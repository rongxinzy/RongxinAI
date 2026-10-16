import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  TARGETS,
  upstream,
  binaryName,
  sha256File,
  verifyRuntime,
  contextTargets,
  configureMagpieResources,
  verifyPackagedMagpie,
} = require('./magpie-runtime.cjs');
const { buildArguments, cleanGoEnvironment, treeDigest } = require('./build-magpie-runtime.cjs');
const { signWithRuntimeManifest } = require('./sign-magpie-macos.cjs');
const temporaryDirectories: string[] = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-magpie-build-test-'));
  temporaryDirectories.push(root);
  return root;
}

function fixture(root: string, key: string) {
  const target = TARGETS[key];
  const directory = path.join(root, key);
  fs.mkdirSync(directory, { recursive: true });
  const binary = path.join(directory, binaryName(key));
  fs.writeFileSync(binary, `test-only compiler output ${key}`, { mode: 0o755 });
  fs.copyFileSync(
    path.join(__dirname, '../resources/magpie/LICENSE'),
    path.join(directory, 'LICENSE'),
  );
  const manifest = {
    schemaVersion: 1,
    platform: target.platform,
    arch: target.arch,
    binary: binaryName(key),
    version: upstream.version,
    sha256: sha256File(binary),
    buildSha256: sha256File(binary),
    sizeBytes: fs.statSync(binary).size,
    source: { commit: upstream.commit, tree: upstream.tree, archiveSha256: upstream.archiveSha256 },
    toolchain: { version: upstream.goVersion },
    build: { version: upstream.version, cgoEnabled: false, tags: 'nogui' },
    license: { sha256: upstream.licenseSha256 },
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  return { directory, binary, manifest };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('pinned Magpie runtime build', () => {
  test('uses the unchanged upstream CLI flags and readonly dependency resolution', () => {
    expect(buildArguments('/out/magpie')).toEqual([
      'build',
      '-mod=readonly',
      '-buildvcs=false',
      '-tags',
      'nogui',
      '-trimpath',
      '-ldflags',
      `-s -w -X main.version=${upstream.version}`,
      '-o',
      '/out/magpie',
      '.',
    ]);
    expect(upstream.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(upstream.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256File(path.join(__dirname, '../resources/magpie/LICENSE'))).toBe(
      upstream.licenseSha256,
    );
  });

  test('isolates the build environment and disables automatic account and toolchain loading', () => {
    const root = temporaryRoot();
    const env = cleanGoEnvironment(root, TARGETS['win32-arm64']);
    expect(env).toMatchObject({
      HOME: path.join(root, 'home'),
      USERPROFILE: path.join(root, 'home'),
      CGO_ENABLED: '0',
      GOOS: 'windows',
      GOARCH: 'arm64',
      GOENV: 'off',
      GOWORK: 'off',
      GOTOOLCHAIN: 'local',
      GOFLAGS: '',
      MAGPIE_NO_ACCOUNTS: '1',
      MAGPIE_ADDR: '127.0.0.1:0',
      GOPROXY: 'https://proxy.golang.org',
      GOSUMDB: 'sum.golang.org',
    });
    expect(env).not.toHaveProperty('MAGPIE_HOME');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  test('detects changes to any source snapshot file', () => {
    const root = temporaryRoot();
    fs.writeFileSync(path.join(root, 'main.go'), 'original');
    const before = treeDigest(root);
    expect(treeDigest(root)).toBe(before);
    fs.writeFileSync(path.join(root, 'main.go'), 'modified');
    expect(treeDigest(root)).not.toBe(before);
  });

  test.each(Object.keys(TARGETS))('validates %s provenance, executable and MIT notice', key => {
    const root = temporaryRoot();
    const { manifest } = fixture(root, key);
    expect(verifyRuntime(root, key)).toEqual(manifest);
  });

  test('fails explicitly for a missing resource, unsupported platform and tampered payload', () => {
    const root = temporaryRoot();
    expect(() => verifyRuntime(root, 'linux-x64')).toThrow('before packaging');
    expect(() => verifyRuntime(root, 'linux-ia32')).toThrow('Unsupported');
    const { binary } = fixture(root, 'linux-x64');
    fs.appendFileSync(binary, 'tampered');
    expect(() => verifyRuntime(root, 'linux-x64')).toThrow('SHA-256 mismatch');
  });

  test('rejects manifests from another upstream revision and missing license notices', () => {
    const root = temporaryRoot();
    const { directory, manifest } = fixture(root, 'win32-arm64');
    manifest.source.commit = '0'.repeat(40);
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    expect(() => verifyRuntime(root, 'win32-arm64')).toThrow('pinned upstream');
    fixture(root, 'win32-arm64');
    fs.writeFileSync(path.join(directory, 'LICENSE'), 'replacement notice');
    expect(() => verifyRuntime(root, 'win32-arm64')).toThrow('MIT license');
  });

  test('uses the target architecture and keeps both macOS helpers for universal merging', () => {
    expect(contextTargets({ electronPlatformName: 'win32', arch: 3 })).toEqual(['win32-arm64']);
    expect(contextTargets({ electronPlatformName: 'linux', arch: 1 })).toEqual(['linux-x64']);
    expect(contextTargets({ electronPlatformName: 'darwin', arch: 4 })).toEqual([
      'darwin-x64',
      'darwin-arm64',
    ]);
    expect(contextTargets({ electronPlatformName: 'darwin', arch: 3 })).toEqual([
      'darwin-x64',
      'darwin-arm64',
    ]);
    expect(() => contextTargets({ electronPlatformName: 'linux', arch: 0 })).toThrow('Unsupported');
  });

  test('adds only validated target resources and rejects a missing packaged payload', () => {
    const projectDir = temporaryRoot();
    const root = path.join(projectDir, 'resources', 'magpie');
    fixture(root, 'win32-arm64');
    const context = {
      electronPlatformName: 'win32',
      arch: 3,
      appOutDir: projectDir,
      packager: {
        projectDir,
        config: { extraResources: [{ from: 'unrelated', to: 'unchanged' }] },
      },
    };
    configureMagpieResources(context);
    configureMagpieResources(context);
    expect(context.packager.config.extraResources).toEqual([
      { from: 'unrelated', to: 'unchanged' },
      { from: 'resources/magpie/upstream.json', to: 'magpie/upstream.json' },
      {
        from: 'resources/magpie/win32-arm64',
        to: 'magpie/win32-arm64',
        filter: ['magpie.exe', 'manifest.json', 'LICENSE'],
      },
    ]);
    expect(() => verifyPackagedMagpie(context)).not.toThrow();
    fs.unlinkSync(path.join(root, 'win32-arm64', 'magpie.exe'));
    expect(() => verifyPackagedMagpie(context)).toThrow('unavailable or invalid');
  });

  test('refreshes signed helper hashes before the outer macOS signature and retains compiler hashes', async () => {
    const app = path.join(temporaryRoot(), 'Test.app');
    const root = path.join(app, 'Contents', 'Resources', 'magpie');
    const x64 = fixture(root, 'darwin-x64');
    const arm64 = fixture(root, 'darwin-arm64');
    const perFile = { entitlements: 'retained.plist', hardenedRuntime: true };
    const options = {
      app,
      identity: 'existing-identity',
      keychain: 'existing-keychain',
      optionsForFile: () => perFile,
    };
    await signWithRuntimeManifest(options, async (received: typeof options) => {
      expect(received.identity).toBe(options.identity);
      expect(received.keychain).toBe(options.keychain);
      for (const entry of [x64, arm64]) {
        expect(received.optionsForFile(entry.binary)).toBe(perFile);
        fs.appendFileSync(entry.binary, 'test-signature');
      }
      // The callback must be synchronous: osx-sign reads returned options directly.
      expect(received.optionsForFile(app)).toBe(perFile);
      for (const key of ['darwin-x64', 'darwin-arm64']) {
        expect(() => verifyRuntime(root, key, { allowSigned: true })).not.toThrow();
      }
    });
    const result = verifyRuntime(root, 'darwin-x64', { allowSigned: true });
    expect(result.buildSha256).toBe(x64.manifest.buildSha256);
    expect(result.sha256).not.toBe(result.buildSha256);
    expect(() => verifyRuntime(root, 'darwin-x64')).toThrow('unmodified compiler output');
  });

  test('fails signing when the outer manifest seal callback never runs', async () => {
    const app = path.join(temporaryRoot(), 'Test.app');
    const root = path.join(app, 'Contents', 'Resources', 'magpie');
    fixture(root, 'darwin-x64');
    fixture(root, 'darwin-arm64');
    await expect(signWithRuntimeManifest({ app }, async () => {})).rejects.toThrow('never sealed');
  });
});
