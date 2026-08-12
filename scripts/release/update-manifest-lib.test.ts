import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { artifactIdentity } from './update-manifest-lib.mjs';

const releaseToolsDirectory = path.join(process.cwd(), 'scripts', 'release');

function runScript(script: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [path.join(releaseToolsDirectory, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('online update release tools', () => {
  let temporaryDirectory: string;
  let releaseEnvironment: NodeJS.ProcessEnv;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'update-release-tools-'));
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    releaseEnvironment = {
      UPDATE_MANIFEST_KEY_ID: 'test-release-key',
      UPDATE_MANIFEST_PRIVATE_KEY_BASE64: privateKey
        .export({ format: 'der', type: 'pkcs8' })
        .toString('base64'),
      UPDATE_MANIFEST_PUBLIC_KEY_BASE64: publicKey
        .export({ format: 'der', type: 'spki' })
        .toString('base64'),
    };
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  function createManifest(version: string, filename = 'installer') {
    const windowsArtifact = path.join(temporaryDirectory, `${filename}.exe`);
    const macosArtifact = path.join(temporaryDirectory, `${filename}.dmg`);
    const linuxDebArtifact = path.join(temporaryDirectory, `${filename}.deb`);
    const linuxAppImageArtifact = path.join(temporaryDirectory, `${filename}.AppImage`);
    const manifestPath = path.join(temporaryDirectory, `${version}-${filename}.json`);
    fs.writeFileSync(windowsArtifact, 'windows artifact');
    fs.writeFileSync(macosArtifact, 'macos artifact');
    fs.writeFileSync(linuxDebArtifact, 'linux deb artifact');
    fs.writeFileSync(linuxAppImageArtifact, 'linux appimage artifact');

    const result = runScript(
      'publish-update-manifest.mjs',
      [
        manifestPath,
        version,
        'a'.repeat(40),
        `${windowsArtifact}:win32:x64:lite`,
        `${macosArtifact}:darwin:arm64:default`,
        `${linuxDebArtifact}:linux:x64:deb`,
        `${linuxAppImageArtifact}:linux:x64:appimage`,
      ],
      releaseEnvironment,
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return manifestPath;
  }

  test('publishes signed Ubuntu deb and AppImage targets with their content types', () => {
    const manifestPath = createManifest('2026.7.4', 'linux');
    const collection = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      manifests: Array<{ payload: string }>;
    };
    const payloads = collection.manifests.map(envelope =>
      JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')),
    );

    expect(
      payloads.map(payload => ({
        target: `${payload.artifact.platform}:${payload.artifact.arch}:${payload.artifact.variant}`,
        contentType: payload.artifact.contentType,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          target: 'linux:x64:deb',
          contentType: 'application/vnd.debian.binary-package',
        },
        {
          target: 'linux:x64:appimage',
          contentType: 'application/vnd.appimage',
        },
      ]),
    );
  });

  test('publishes a signed manifest from verified uploaded-artifact metadata', () => {
    const metadataPath = path.join(temporaryDirectory, 'uploaded-artifacts.json');
    const manifestPath = path.join(temporaryDirectory, 'metadata-manifest.json');
    const version = '2026.7.5';
    const artifacts = [
      ['win32', 'x64', 'lite', 'installer.exe'],
      ['darwin', 'arm64', 'default', 'installer.dmg'],
      ['linux', 'x64', 'deb', 'installer.deb'],
      ['linux', 'x64', 'appimage', 'installer.AppImage'],
    ].map(([platform, arch, variant, filename], index) => ({
      platform,
      arch,
      variant,
      filename,
      key: `releases/${version}/${platform}-${arch}-${variant}/${filename}`,
      size: index + 1,
      sha256: `${index}`.repeat(64),
      sha512: crypto.createHash('sha512').update(`sha512-${index}`).digest('base64'),
    }));
    artifacts.push(
      ...artifacts.map(artifact => ({
        ...artifact,
        kind: 'updater',
        filename:
          artifact.platform === 'darwin' ? 'installer.zip' : artifact.filename,
        key: `releases/${version}/${artifact.platform}-${artifact.arch}-${artifact.variant}/${artifact.platform === 'darwin' ? 'installer.zip' : artifact.filename}`,
      })),
    );
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({ schemaVersion: 1, releaseVersion: version, artifacts }),
    );

    const result = runScript(
      'publish-update-manifest.mjs',
      [manifestPath, version, 'b'.repeat(40), '--metadata', metadataPath],
      releaseEnvironment,
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const collection = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      manifests: Array<{ payload: string }>;
    };
    const payloads = collection.manifests.map(envelope =>
      JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')),
    );
    expect(payloads.map(payload => payload.artifact.sha256)).toEqual(
      artifacts.filter(artifact => !artifact.kind || artifact.kind === 'installer').map(artifact => artifact.sha256),
    );
    expect(payloads.find(payload => payload.artifact.platform === 'darwin').artifact.updater.filename).toBe(
      'installer.zip',
    );
  });

  test('rejects uploaded metadata with a missing, duplicate, or unexpected release target', () => {
    const version = '2026.7.5';
    const artifacts = [
      ['win32', 'x64', 'lite', 'installer.exe'],
      ['darwin', 'arm64', 'default', 'installer.dmg'],
      ['linux', 'x64', 'deb', 'installer.deb'],
      ['linux', 'x64', 'appimage', 'installer.AppImage'],
    ].map(([platform, arch, variant, filename], index) => ({
      platform,
      arch,
      variant,
      filename,
      key: `releases/${version}/${platform}-${arch}-${variant}/${filename}`,
      size: index + 1,
      sha256: `${index}`.repeat(64),
      sha512: crypto.createHash('sha512').update(`sha512-${index}`).digest('base64'),
    }));
    const updaterArtifacts = artifacts.map(artifact => ({
      ...artifact,
      kind: 'updater',
      filename: artifact.platform === 'darwin' ? 'installer.zip' : artifact.filename,
      key: `releases/${version}/${artifact.platform}-${artifact.arch}-${artifact.variant}/${artifact.platform === 'darwin' ? 'installer.zip' : artifact.filename}`,
    }));

    for (const [caseName, invalidArtifacts, expectedError] of [
      ['missing', [...artifacts.slice(0, -1), ...updaterArtifacts], 'must contain exactly the required targets'],
      ['duplicate', [...artifacts, artifacts[0], ...updaterArtifacts], 'Duplicate release target'],
      [
        'missing-updater',
        [...artifacts, ...updaterArtifacts.slice(0, -1)],
        'must contain exactly one updater artifact',
      ],
      [
        'unexpected',
        [
          ...artifacts,
          ...updaterArtifacts,
          {
            ...artifacts[1],
            arch: 'x64',
            key: `releases/${version}/darwin-x64-default/installer.dmg`,
          },
        ],
        'must contain exactly the required targets',
      ],
    ] as const) {
      const metadataPath = path.join(temporaryDirectory, `${caseName}-artifacts.json`);
      const manifestPath = path.join(temporaryDirectory, `${caseName}-manifest.json`);
      fs.writeFileSync(
        metadataPath,
        JSON.stringify({ schemaVersion: 1, releaseVersion: version, artifacts: invalidArtifacts }),
      );
      const result = runScript(
        'publish-update-manifest.mjs',
        [manifestPath, version, 'b'.repeat(40), '--metadata', metadataPath],
        releaseEnvironment,
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(expectedError);
      expect(fs.existsSync(manifestPath)).toBe(false);
    }
  });

  test('enforces monotonic versions and same-version artifact idempotency', () => {
    const currentManifest = createManifest('2026.7.3', 'current');
    const outputPath = path.join(temporaryDirectory, 'github-output.txt');

    const idempotentResult = runScript(
      'verify-update-transition.mjs',
      [currentManifest, currentManifest, '2026.7.3'],
      { ...releaseEnvironment, GITHUB_OUTPUT: outputPath },
    );
    expect(idempotentResult.status).toBe(0);
    expect(fs.readFileSync(outputPath, 'utf8')).toContain('idempotent=true');

    const olderManifest = createManifest('2026.7.2', 'older');
    const downgradeResult = runScript(
      'verify-update-transition.mjs',
      [currentManifest, olderManifest, '2026.7.2'],
      releaseEnvironment,
    );
    expect(downgradeResult.status).not.toBe(0);
    expect(downgradeResult.stderr).toContain('Refusing to replace newer stable version');

    const conflictingManifest = createManifest('2026.7.3', 'conflict');
    const conflictResult = runScript(
      'verify-update-transition.mjs',
      [currentManifest, conflictingManifest, '2026.7.3'],
      releaseEnvironment,
    );
    expect(conflictResult.status).not.toBe(0);
    expect(conflictResult.stderr).toContain('already exists with different artifacts');
  });

  test('includes the electron-updater artifact in same-version identity checks', () => {
    const payload = {
      artifact: {
        platform: 'darwin',
        arch: 'arm64',
        variant: 'default',
        url: 'https://downloads.rongxzyai.com/releases/2026.7.3/darwin-arm64-default/app.dmg',
        size: 10,
        sha256: 'a'.repeat(64),
        updater: {
          filename: 'app.zip',
          url: 'https://downloads.rongxzyai.com/releases/2026.7.3/darwin-arm64-default/app.zip',
          size: 11,
          sha512: crypto.createHash('sha512').update('updater-a').digest('base64'),
        },
      },
    };
    const changedUpdater = structuredClone(payload);
    changedUpdater.artifact.updater.sha512 = crypto
      .createHash('sha512')
      .update('updater-b')
      .digest('base64');

    expect(artifactIdentity(payload).value).not.toBe(artifactIdentity(changedUpdater).value);
  });

  test('keeps referenced and recent objects while deleting expired orphans', () => {
    const stableManifest = createManifest('2026.7.3', 'current');
    const objectListPath = path.join(temporaryDirectory, 'objects.json');
    const cleanupDirectory = path.join(temporaryDirectory, 'cleanup');
    const now = Date.now();
    fs.writeFileSync(
      objectListPath,
      JSON.stringify({
        Contents: [
          {
            Key: 'releases/2026.7.3/win32-x64-lite/current.exe',
            LastModified: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
          },
          {
            Key: 'releases/2026.7.3/win32-x64-lite/current.exe.blockmap',
            LastModified: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
          },
          {
            Key: 'releases/2026.7.1/win32-x64-lite/expired.exe',
            LastModified: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
          },
          {
            Key: 'releases/2026.7.2/win32-x64-lite/recent.exe',
            LastModified: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
          },
          {
            Key: 'generations/active-opaque-id/legacy/stable.json',
            LastModified: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
          },
          {
            Key: 'generations/2026.7.3/legacy/stable.json',
            LastModified: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
          },
          {
            Key: 'generations/2026.7.1/electron/win32-x64-lite/latest.yml',
            LastModified: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
          },
          {
            Key: 'generations/2026.7.2/legacy/stable.json',
            LastModified: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
          },
        ],
      }),
    );

    const result = runScript(
      'plan-r2-cleanup.mjs',
      [stableManifest, '-', '-', 'active-opaque-id', '-', objectListPath, cleanupDirectory],
      releaseEnvironment,
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const deletePlan = JSON.parse(
      fs.readFileSync(path.join(cleanupDirectory, 'delete-001.json'), 'utf8'),
    );
    expect(deletePlan.Objects).toEqual([
      { Key: 'releases/2026.7.1/win32-x64-lite/expired.exe' },
      { Key: 'generations/2026.7.3/legacy/stable.json' },
      { Key: 'generations/2026.7.1/electron/win32-x64-lite/latest.yml' },
    ]);
  });

  test('normalizes a multi-file Linux feed to a versioned AppImage Worker URL', () => {
    const inputPath = path.join(temporaryDirectory, 'latest-linux.yml');
    const outputPath = path.join(temporaryDirectory, 'normalized.yml');
    const debSha512 = crypto.createHash('sha512').update('deb').digest('base64');
    const appImageSha512 = crypto.createHash('sha512').update('appimage').digest('base64');
    fs.writeFileSync(
      inputPath,
      yaml.dump({
        version: '2026.7.6',
        files: [
          { url: 'ZhiYuan.deb', sha512: debSha512 },
          { url: 'ZhiYuan.AppImage', sha512: appImageSha512 },
        ],
        path: 'ZhiYuan.AppImage',
        sha512: appImageSha512,
        releaseDate: '2026-08-06T00:00:00.000Z',
      }),
    );
    const result = runScript(
      'normalize-electron-updater-metadata.mjs',
      ['2026.7.6', 'linux', 'x64', 'appimage', inputPath, outputPath],
      releaseEnvironment,
    );
    expect(result.status).toBe(0);
    const normalized = yaml.load(fs.readFileSync(outputPath, 'utf8')) as any;
    expect(normalized.files).toEqual([
      {
        url: 'https://updates.rongxzyai.com/v2/electron/releases/2026.7.6/linux/x64/appimage/ZhiYuan.AppImage',
        sha512: appImageSha512,
      },
    ]);
    expect(normalized.path).toBe(normalized.files[0].url);
    expect(normalized.releaseDate).toBe('2026-08-06T00:00:00.000Z');
  });

  test('rejects unsafe updater filenames while normalizing metadata', () => {
    const inputPath = path.join(temporaryDirectory, 'unsafe.yml');
    fs.writeFileSync(
      inputPath,
      yaml.dump({
        version: '2026.7.6',
        files: [{ url: '../escape.AppImage', sha512: 'sha512' }],
        path: '../escape.AppImage',
        sha512: 'sha512',
      }),
    );
    const result = runScript(
      'normalize-electron-updater-metadata.mjs',
      ['2026.7.6', 'linux', 'x64', 'appimage', inputPath, path.join(temporaryDirectory, 'out.yml')],
      releaseEnvironment,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unsafe artifact name');
  });

  test('verifies every electron-updater generation target exactly once', () => {
    const version = '2026.7.7';
    const targets = [
      ['win32', 'x64', 'lite', 'latest.yml', 'ZhiYuan.exe'],
      ['darwin', 'arm64', 'default', 'latest-mac.yml', 'ZhiYuan.zip'],
      ['linux', 'x64', 'appimage', 'latest-linux.yml', 'ZhiYuan.AppImage'],
      ['linux', 'x64', 'deb', 'latest-linux.yml', 'ZhiYuan.deb'],
    ] as const;
    const artifactMetadataPath = path.join(temporaryDirectory, 'generation-artifacts.json');
    const artifacts = [];
    const metadataSpecs = [];
    for (const [platform, arch, variant, metadataName, filename] of targets) {
      const targetDirectory = path.join(temporaryDirectory, `${platform}-${arch}-${variant}`);
      fs.mkdirSync(targetDirectory);
      const metadataPath = path.join(targetDirectory, metadataName);
      const sha512 = crypto
        .createHash('sha512')
        .update(`${platform}-${variant}`)
        .digest('base64');
      const url = `https://updates.rongxzyai.com/v2/electron/releases/${version}/${platform}/${arch}/${variant}/${filename}`;
      fs.writeFileSync(
        metadataPath,
        yaml.dump({ version, files: [{ url, sha512 }], path: url, sha512 }),
      );
      metadataSpecs.push(`${metadataPath}:${platform}:${arch}:${variant}`);
      artifacts.push({ platform, arch, variant, kind: 'updater', filename, sha512 });
    }
    fs.writeFileSync(
      artifactMetadataPath,
      JSON.stringify({ schemaVersion: 1, releaseVersion: version, artifacts }),
    );

    const valid = runScript(
      'verify-electron-updater-generation.mjs',
      [version, ...metadataSpecs, '--artifact-metadata', artifactMetadataPath],
      releaseEnvironment,
    );
    expect(valid.status).toBe(0);

    const duplicate = runScript(
      'verify-electron-updater-generation.mjs',
      [
        version,
        metadataSpecs[0],
        metadataSpecs[0],
        metadataSpecs[1],
        metadataSpecs[2],
        '--artifact-metadata',
        artifactMetadataPath,
      ],
      releaseEnvironment,
    );
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain('Duplicate electron-updater metadata target');
  });
});
