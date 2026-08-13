import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  CandidateTarget,
  createCandidateManifest,
  verifyCandidateManifests,
} from './release-candidate-manifest.mjs';

const VERSION = '2026.8.13-build.2';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const RUN_ID = '123456789';
const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-release-candidate-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeArtifact(directory: string, filename: string, content = filename) {
  const filePath = path.join(directory, filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return filePath;
}

function spec(filePath: string, target: string, kind: string) {
  const [platform, arch, ...variantParts] = target.split('-');
  return `${filePath}:${platform}:${arch}:${variantParts.join('-')}:${kind}`;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('release candidate manifest', () => {
  test('creates a payload with immutable identity and hashes', async () => {
    const source = await temporaryDirectory();
    const output = await temporaryDirectory();
    const installer = await writeArtifact(source, 'ZhiYuan-Setup.exe', 'candidate bytes');
    const blockmap = await writeArtifact(source, 'ZhiYuan-Setup.exe.blockmap');
    const metadata = await writeArtifact(source, 'latest.yml');

    const manifest = await createCandidateManifest({
      releaseVersion: VERSION,
      sourceCommit: COMMIT,
      candidateRunId: RUN_ID,
      outputDirectory: output,
      manifestName: 'candidate-win32-x64-lite.json',
      specs: [
        spec(installer, CandidateTarget.WindowsX64Lite, 'installer'),
        spec(installer, CandidateTarget.WindowsX64Lite, 'updater'),
        spec(blockmap, CandidateTarget.WindowsX64Lite, 'blockmap'),
        spec(metadata, CandidateTarget.WindowsX64Lite, 'metadata'),
      ],
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      releaseVersion: VERSION,
      sourceCommit: COMMIT,
      candidateRunId: RUN_ID,
    });
    expect(manifest.artifacts).toHaveLength(4);
    expect(new Set(manifest.artifacts.map(artifact => artifact.relativePath)).size).toBe(3);
    expect(manifest.artifacts.every(artifact => /^[0-9a-f]{64}$/.test(artifact.sha256))).toBe(true);
    expect(await fs.readFile(path.join(output, 'payload', CandidateTarget.WindowsX64Lite, 'ZhiYuan-Setup.exe'), 'utf8')).toBe(
      'candidate bytes',
    );
  });

  test('accepts only a complete three-platform candidate', async () => {
    const manifests = [
      {
        target: CandidateTarget.WindowsX64Lite,
        kinds: ['installer', 'updater', 'blockmap', 'metadata'],
      },
      {
        target: CandidateTarget.MacArm64Default,
        kinds: ['installer', 'updater', 'blockmap', 'metadata'],
      },
      {
        target: CandidateTarget.LinuxX64AppImage,
        kinds: ['installer', 'updater', 'metadata'],
      },
      {
        target: CandidateTarget.LinuxX64Deb,
        kinds: ['installer', 'updater', 'metadata'],
      },
    ].map(({ target, kinds }) => {
      const [platform, arch, ...variantParts] = target.split('-');
      const variant = variantParts.join('-');
      return {
        schemaVersion: 1,
        releaseVersion: VERSION,
        sourceCommit: COMMIT,
        candidateRunId: RUN_ID,
        artifacts: kinds.map(kind => ({
          platform,
          arch,
          variant,
          kind,
          filename: `${target}-${kind}.bin`,
          relativePath: `payload/${target}/${target}-${kind}.bin`,
          size: 1,
          sha256: 'a'.repeat(64),
          sha512: `${'A'.repeat(86)}==`,
        })),
      };
    });

    await expect(
      verifyCandidateManifests({
        releaseVersion: VERSION,
        sourceCommit: COMMIT,
        candidateRunId: RUN_ID,
        manifests,
      }),
    ).resolves.toBeUndefined();

    manifests[0].artifacts.pop();
    await expect(
      verifyCandidateManifests({
        releaseVersion: VERSION,
        sourceCommit: COMMIT,
        candidateRunId: RUN_ID,
        manifests,
      }),
    ).rejects.toThrow('Candidate is incomplete');
  });

  test('rejects payload bytes changed after candidate assembly', async () => {
    const source = await temporaryDirectory();
    const output = await temporaryDirectory();
    const installer = await writeArtifact(source, 'ZhiYuan-Setup.exe', 'original');
    const manifest = await createCandidateManifest({
      releaseVersion: VERSION,
      sourceCommit: COMMIT,
      candidateRunId: RUN_ID,
      outputDirectory: output,
      manifestName: 'candidate-win32-x64-lite.json',
      specs: [spec(installer, CandidateTarget.WindowsX64Lite, 'installer')],
    });
    await fs.writeFile(
      path.join(output, 'payload', CandidateTarget.WindowsX64Lite, 'ZhiYuan-Setup.exe'),
      'changed',
    );

    await expect(
      verifyCandidateManifests({
        releaseVersion: VERSION,
        sourceCommit: COMMIT,
        candidateRunId: RUN_ID,
        manifests: [manifest],
        payloadRoots: [output],
        requireComplete: false,
      }),
    ).rejects.toThrow('bytes do not match');
  });

  test('rejects a candidate from a different run or source commit', async () => {
    const manifest = {
      schemaVersion: 1,
      releaseVersion: VERSION,
      sourceCommit: COMMIT,
      candidateRunId: RUN_ID,
      artifacts: [
        {
          platform: 'win32',
          arch: 'x64',
          variant: 'lite',
          kind: 'installer',
          filename: 'candidate.exe',
          relativePath: 'payload/win32-x64-lite/candidate.exe',
          size: 1,
          sha256: 'a'.repeat(64),
          sha512: `${'A'.repeat(86)}==`,
        },
      ],
    };

    await expect(
      verifyCandidateManifests({
        releaseVersion: VERSION,
        sourceCommit: 'f'.repeat(40),
        candidateRunId: RUN_ID,
        manifests: [manifest],
        requireComplete: false,
      }),
    ).rejects.toThrow('source commit mismatch');
    await expect(
      verifyCandidateManifests({
        releaseVersion: VERSION,
        sourceCommit: COMMIT,
        candidateRunId: '987654321',
        manifests: [manifest],
        requireComplete: false,
      }),
    ).rejects.toThrow('run ID mismatch');
  });

  test('rejects an artifact path outside its declared target', async () => {
    const manifest = {
      schemaVersion: 1,
      releaseVersion: VERSION,
      sourceCommit: COMMIT,
      candidateRunId: RUN_ID,
      artifacts: [
        {
          platform: 'win32',
          arch: 'x64',
          variant: 'lite',
          kind: 'installer',
          filename: 'candidate.exe',
          relativePath: 'payload/darwin-arm64-default/candidate.exe',
          size: 1,
          sha256: 'a'.repeat(64),
          sha512: `${'A'.repeat(86)}==`,
        },
      ],
    };

    await expect(
      verifyCandidateManifests({
        releaseVersion: VERSION,
        sourceCommit: COMMIT,
        candidateRunId: RUN_ID,
        manifests: [manifest],
        requireComplete: false,
      }),
    ).rejects.toThrow('filename does not match its path');
  });
});
