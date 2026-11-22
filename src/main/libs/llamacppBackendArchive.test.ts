import { createHash } from 'node:crypto';
import fsStreams from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, vi } from 'vitest';

import { listLlamaCppBackends } from './llamacppBackendManager';
import { downloadArchive } from './llamacppBackendManager/support';

vi.mock('./fileHasher', async importOriginal => {
  const { sha256FileStream } = await importOriginal<typeof import('./fileHasher')>();
  const workerPath = fileURLToPath(new URL('./hashWorker.ts', import.meta.url));
  return {
    sha256FileStream: (
      file: string,
      options: NonNullable<Parameters<typeof sha256FileStream>[1]>,
    ) => sha256FileStream(file, { ...options, workerPath }),
  };
});

test('lists the exact combined backend and companion download size', async () => {
  const { backends } = await listLlamaCppBackends({
    runtimeRoot: path.join(os.tmpdir(), 'unused-backend-size-fixture'),
    platform: 'win32',
    arch: 'x64',
    hasNvidiaGpu: true,
    manifest: {
      schemaVersion: 1,
      defaultVersion: 'b9518',
      backends: [
        {
          version: 'b9518',
          backend: 'win-x64-cuda-12',
          platform: 'win32',
          arch: 'x64',
          accelerator: 'cuda',
          cudaMajor: '12',
          archive: { assetName: 'backend.zip', size: 100 },
          companions: [
            {
              assetName: 'cuda.zip',
              parts: [
                { assetName: 'cuda.part-a', size: 20 },
                { assetName: 'cuda.part-b', size: 30 },
              ],
            },
          ],
        },
      ],
    },
  });

  expect(backends[0]?.downloadSizeBytes).toBe(150);
});

test('verifies split archives before publishing and retains valid parts for retry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backend-archive-'));
  try {
    const downloadDir = path.join(root, 'downloads');
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    const parts = await Promise.all(
      ['first', 'last'].map(async (data, index) => {
        const assetName = `backend.part-${index}`;
        const source = path.join(root, assetName);
        await fs.writeFile(source, data);
        return { assetName, url: pathToFileURL(source).href, sha256: digest(data) };
      }),
    );
    const manifest = { schemaVersion: 1 as const, defaultVersion: 'test', backends: [] };
    const archive = { assetName: 'backend.zip', parts, sha256: digest('wrong') };
    const outputPath = path.join(downloadDir, archive.assetName);
    await expect(downloadArchive(archive, manifest, downloadDir)).rejects.toThrow(
      'SHA256 mismatch for backend.zip.',
    );
    expect((await fs.readdir(downloadDir)).sort()).toEqual(parts.map(part => part.assetName));

    const controller = new AbortController();
    const createWriteStream = fsStreams.createWriteStream;
    const writes = vi.spyOn(fsStreams, 'createWriteStream').mockImplementation(file => {
      const stream = createWriteStream(file);
      if (file === `${outputPath}.assembling`) queueMicrotask(() => controller.abort());
      return stream;
    });
    try {
      await expect(
        downloadArchive(archive, manifest, downloadDir, undefined, controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect((await fs.readdir(downloadDir)).sort()).toEqual(parts.map(part => part.assetName));
    } finally {
      writes.mockRestore();
    }

    await expect(
      downloadArchive({ ...archive, sha256: digest('firstlast') }, manifest, downloadDir),
    ).resolves.toBe(outputPath);
    expect(await fs.readFile(outputPath, 'utf8')).toBe('firstlast');
    expect(await fs.readdir(downloadDir)).not.toContain('backend.zip.assembling');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
