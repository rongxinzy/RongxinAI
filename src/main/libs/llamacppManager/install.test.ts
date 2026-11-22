import fs from 'fs';
import '../../../../tests/helpers/mockLlamaCppCatalogWorker';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { expect, test, vi } from 'vitest';

import type { MarketplaceModel } from '../../../shared/marketplace';
import { LlamaCppManager } from '../llamacppManager';

vi.mock('../fileHasher', async importOriginal => {
  const { sha256FileStream } = await importOriginal<typeof import('../fileHasher')>();
  return {
    sha256FileStream: (file: string, options: Parameters<typeof sha256FileStream>[1]) =>
      sha256FileStream(file, {
        ...options,
        workerPath: path.resolve('src/main/libs/hashWorker.ts'),
      }),
  };
});

function verifiedMarketplaceModel(input: {
  repoId?: string;
  filePath?: string;
  downloadUrl?: string;
  sha256: string;
  mmproj?: { path: string; downloadUrl: string; sha256: string };
}): MarketplaceModel {
  const repoId = input.repoId ?? 'Qwen/Qwen3-8B-GGUF';
  const filePath = input.filePath ?? 'Qwen3-8B-Q4_K_M.gguf';
  const files = [
    {
      path: filePath,
      sizeBytes: 8,
      sha256: input.sha256,
      isRecommended: true,
      kind: 'model' as const,
      revision: 'commit-sha',
      downloadUrl: input.downloadUrl ?? 'https://download.test/model.gguf',
    },
    ...(input.mmproj
      ? [
          {
            path: input.mmproj.path,
            sizeBytes: 8,
            sha256: input.mmproj.sha256,
            kind: 'mmproj' as const,
            revision: 'commit-sha',
            downloadUrl: input.mmproj.downloadUrl,
          },
        ]
      : []),
  ];
  return {
    source: 'modelscope-gguf',
    id: repoId,
    repoId,
    name: repoId,
    description: 'verified cloud metadata',
    tags: ['chat', 'gguf'],
    sizes: ['desktop'],
    recommendedTag: 'Q4_K_M',
    capability: 'chat',
    capabilities: ['chat'],
    filePath,
    installed: false,
    files,
    mmprojFilePath: input.mmproj?.path,
    metadataStatus: 'verified',
    runtime: {
      format: 'gguf',
      status: 'candidate',
      ggufFilesVerified: true,
      sha256Verified: true,
      source: 'modelscope-file-api',
      observedAt: '2026-08-01T00:00:00.000Z',
      revision: 'commit-sha',
      reasons: ['端侧加载探针待执行。'],
    },
  };
}

test('installModel rejects a repository without cloud-verified GGUF metadata', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-unverified-'));
  const marketplaceService = {
    resolveModel: async () => null,
  };
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  await expect(manager.installModel({ modelId: 'owner/unverified-GGUF' })).rejects.toThrow(
    'cloud catalogue has not verified',
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test('installModel downloads and verifies the exact GGUF selected by the cloud catalogue', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-verified-'));
  const bytes = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const marketplaceService = {
    resolveModel: async () => verifiedMarketplaceModel({ sha256 }),
  };
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    expect(String(input)).toBe('https://download.test/model.gguf');
    return new Response(bytes, { status: 200, headers: { 'content-length': '8' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const result = await manager.installModel({ modelId: 'Qwen/Qwen3-8B-GGUF' });

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(result.path).toContain(path.join('Qwen', 'Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf'));
  expect(fs.readFileSync(result.path)).toEqual(Buffer.from(bytes));
});

test('installModel rejects checksum-valid bytes that are not a GGUF container', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-invalid-gguf-'));
  const bytes = new Uint8Array([0x4e, 0x4f, 0x54, 0x47, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const marketplaceService = {
    resolveModel: async () => verifiedMarketplaceModel({ sha256 }),
  };
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes, { status: 200, headers: { 'content-length': '8' } })),
  );

  await expect(manager.installModel({ modelId: 'Qwen/Qwen3-8B-GGUF' })).rejects.toThrow(
    'invalid GGUF magic bytes',
  );
  expect(
    fs.existsSync(
      path.join(modelsDir, 'modelscope', 'Qwen', 'Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf.download'),
    ),
  ).toBe(false);
});

test('cleans up the original library if a download fails after the configured directory changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-directory-change-'));
  const originalDir = path.join(root, 'original');
  const nextDir = path.join(root, 'next');
  let modelsDir = originalDir;
  const bytes = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const marketplace = {
    resolveModel: async () => {
      modelsDir = nextDir;
      return verifiedMarketplaceModel({
        sha256,
        mmproj: { path: 'mmproj.gguf', downloadUrl: 'https://download.test/mmproj.gguf', sha256 },
      });
    },
  };
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplace);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) =>
      String(input).includes('mmproj')
        ? new Response(null, { status: 403 })
        : new Response(bytes, { headers: { 'content-length': '8' } }),
    ),
  );
  try {
    await expect(manager.installModel({ modelId: 'Qwen/Qwen3-8B-GGUF' })).rejects.toThrow('403');
    expect(fs.readdirSync(originalDir)).toEqual([]);
    expect(fs.existsSync(nextDir)).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installModel keeps an interrupted partial file for a later Range resume', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-resume-'));
  const bytes = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const marketplaceService = {
    resolveModel: async () =>
      verifiedMarketplaceModel({
        sha256,
        mmproj: {
          path: 'mmproj-F16.gguf',
          downloadUrl: 'https://download.test/mmproj.gguf',
          sha256,
        },
      }),
  };
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/model.gguf')) {
        return new Response(bytes, { status: 200, headers: { 'content-length': '8' } });
      }
      return new Response(
        new ReadableStream({
          start(streamController) {
            streamController.enqueue(new Uint8Array([4]));
            streamController.close();
          },
        }),
        { status: 200, headers: { 'content-length': '3' } },
      );
    }),
  );

  const install = manager.installModel(
    { modelId: 'Qwen/Qwen3-8B-GGUF' },
    progress => {
      if (progress.targetPath?.endsWith('mmproj-F16.gguf') && progress.completed === 1) {
        controller.abort(new Error('Install cancelled'));
      }
    },
    { signal: controller.signal },
  );

  await expect(install).rejects.toThrow();
  const repoDir = path.join(modelsDir, 'modelscope', 'Qwen', 'Qwen3-8B-GGUF');
  expect(fs.existsSync(path.join(repoDir, 'Qwen3-8B-Q4_K_M.gguf'))).toBe(false);
  expect(fs.existsSync(path.join(repoDir, 'mmproj-F16.gguf.download'))).toBe(true);
});

test('installModel refreshes cloud metadata once after a stale download URL returns 404', async () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-install-refresh-'));
  const bytes = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let resolveCount = 0;
  const marketplaceService = {
    resolveModel: async () => {
      resolveCount += 1;
      return verifiedMarketplaceModel({
        filePath: resolveCount === 1 ? 'stale.gguf' : 'fresh.gguf',
        downloadUrl:
          resolveCount === 1
            ? 'https://download.test/stale.gguf'
            : 'https://download.test/fresh.gguf',
        sha256,
      });
    },
  };
  const manager = new LlamaCppManager(() => ({ modelsDir }), marketplaceService);
  const fetchMock = vi.fn(async (input: string | URL | Request) =>
    String(input).endsWith('/stale.gguf')
      ? new Response('not found', { status: 404 })
      : new Response(bytes, { status: 200, headers: { 'content-length': '8' } }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const result = await manager.installModel({ modelId: 'Qwen/Qwen3-8B-GGUF' });

  expect(resolveCount).toBe(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.path).toContain('fresh.gguf');
});
