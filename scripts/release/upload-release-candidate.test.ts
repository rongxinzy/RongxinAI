import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { createImmutableUploader } from './upload-release-candidate.mjs';

const VERSION = '2026.8.13-build.2';
const temporaryDirectories: string[] = [];

async function candidateArtifact(kind = 'installer') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-candidate-upload-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'ZhiYuan-Setup.exe');
  const content = Buffer.from('validated candidate bytes');
  await fs.writeFile(filePath, content);
  return {
    filePath,
    artifact: {
      platform: 'win32',
      arch: 'x64',
      variant: 'lite',
      kind,
      filename: path.basename(filePath),
      relativePath: `payload/win32-x64-lite/${path.basename(filePath)}`,
      size: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      sha512: crypto.createHash('sha512').update(content).digest('base64'),
    },
  };
}

function result(status: number, stdout = '', stderr = '') {
  return { status, stdout, stderr };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('release candidate immutable upload', () => {
  test('accepts an identical existing immutable object without uploading it', async () => {
    const { filePath, artifact } = await candidateArtifact();
    const runAws = vi.fn((args: string[]) =>
      args.includes('{size:ContentLength,sha256:Metadata.sha256,sha512:Metadata.sha512}')
        ? result(
            0,
            JSON.stringify({ size: artifact.size, sha256: artifact.sha256, sha512: artifact.sha512 }),
          )
        : result(0, String(artifact.size)),
    );
    const upload = createImmutableUploader({ bucket: 'test', releaseVersion: VERSION, runAws });

    await expect(upload(filePath, artifact, new Map())).resolves.toContain(`releases/${VERSION}/`);
    expect(runAws.mock.calls.some(([args]) => args.includes('put-object'))).toBe(false);
  });

  test('rejects an existing immutable object with different content', async () => {
    const { filePath, artifact } = await candidateArtifact();
    const runAws = vi.fn(() =>
      result(0, JSON.stringify({ size: artifact.size, sha256: '0'.repeat(64), sha512: artifact.sha512 })),
    );
    const upload = createImmutableUploader({ bucket: 'test', releaseVersion: VERSION, runAws });

    await expect(upload(filePath, artifact, new Map())).rejects.toThrow(
      'Immutable object already exists with different content',
    );
  });

  test('rejects local bytes changed after candidate validation before calling R2', async () => {
    const { filePath, artifact } = await candidateArtifact();
    await fs.writeFile(filePath, 'changed after validation');
    const runAws = vi.fn();
    const upload = createImmutableUploader({ bucket: 'test', releaseVersion: VERSION, runAws });

    await expect(upload(filePath, artifact, new Map())).rejects.toThrow('Candidate bytes changed before upload');
    expect(runAws).not.toHaveBeenCalled();
  });

  test('uploads one object for installer and updater roles sharing the same bytes', async () => {
    const { filePath, artifact: installer } = await candidateArtifact();
    const updater = { ...installer, kind: 'updater' };
    let exists = false;
    const runAws = vi.fn((args: string[]) => {
      if (args.includes('put-object')) {
        exists = true;
        return result(0);
      }
      if (args.includes('{size:ContentLength,sha256:Metadata.sha256,sha512:Metadata.sha512}')) {
        return exists
          ? result(
              0,
              JSON.stringify({ size: installer.size, sha256: installer.sha256, sha512: installer.sha512 }),
            )
          : result(1, '', 'NoSuchKey');
      }
      return result(0, String(installer.size));
    });
    const upload = createImmutableUploader({ bucket: 'test', releaseVersion: VERSION, runAws });
    const uploadedObjects = new Map();

    const installerKey = await upload(filePath, installer, uploadedObjects);
    const updaterKey = await upload(filePath, updater, uploadedObjects);

    expect(updaterKey).toBe(installerKey);
    expect(runAws.mock.calls.filter(([args]) => args.includes('put-object'))).toHaveLength(1);
  });

  test('accepts an identical object won by another uploader after a conditional write race', async () => {
    const { filePath, artifact } = await candidateArtifact();
    let headCalls = 0;
    const runAws = vi.fn((args: string[]) => {
      if (args.includes('put-object')) return result(1, '', 'PreconditionFailed');
      if (args.includes('{size:ContentLength,sha256:Metadata.sha256,sha512:Metadata.sha512}')) {
        headCalls += 1;
        return headCalls === 1
          ? result(1, '', 'NoSuchKey')
          : result(
              0,
              JSON.stringify({ size: artifact.size, sha256: artifact.sha256, sha512: artifact.sha512 }),
            );
      }
      return result(0, String(artifact.size));
    });
    const upload = createImmutableUploader({
      bucket: 'test',
      releaseVersion: VERSION,
      runAws,
      wait: async () => {},
    });

    await expect(upload(filePath, artifact, new Map())).resolves.toBeTruthy();
    expect(headCalls).toBe(2);
  });
});
