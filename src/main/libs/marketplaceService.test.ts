import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import { MarketplaceService } from './marketplaceService';

const tempDirs: string[] = [];
const SHA = 'a'.repeat(64);

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-model-marketplace-'));
  tempDirs.push(dir);
  return dir;
}

function verifiedModel(repoId = 'Qwen/Qwen3-8B-GGUF') {
  return {
    source: 'modelscope-gguf',
    id: repoId,
    repoId,
    name: repoId.split('/')[1],
    description: 'Text generation model',
    tags: ['chat', 'reasoning', 'gguf'],
    sizes: ['desktop'],
    recommendedTag: 'Q4_K_M',
    capability: ['chat', 'reasoning'],
    filePath: 'Qwen3-8B-Q4_K_M.gguf',
    metadataStatus: 'verified',
    runtime: {
      format: 'gguf',
      status: 'documented',
      ggufFilesVerified: true,
      sha256Verified: true,
      source: 'modelscope-file-api',
      observedAt: '2026-08-01T00:00:00.000Z',
      revision: 'commit-sha',
      reasons: ['文件已校验，仍待端侧探针。'],
    },
    files: [
      {
        path: 'Qwen3-8B-Q4_K_M.gguf',
        sizeBytes: 5_027_783_488,
        sha256: SHA,
        quantization: 'Q4_K_M',
        isRecommended: true,
        kind: 'model',
        revision: 'commit-sha',
        downloadUrl:
          'https://modelscope.cn/models/Qwen/Qwen3-8B-GGUF/resolve/commit-sha/Qwen3-8B-Q4_K_M.gguf',
      },
    ],
  };
}

test('MarketplaceService marks installed models from the configured local-model directory', () => {
  const modelsDir = createTempDir();
  const installedPath = path.join(
    modelsDir,
    'modelscope',
    'Qwen',
    'Qwen2.5-7B-Instruct-GGUF',
    'qwen2.5-7b-instruct-q4_k_m.gguf',
  );
  fs.mkdirSync(path.dirname(installedPath), { recursive: true });
  fs.writeFileSync(installedPath, '');

  const service = new MarketplaceService(() => modelsDir);
  const result = service.searchLocal({ query: 'Qwen2.5 7B Instruct', limit: 10 });
  const model = result.find(item => item.repoId === 'Qwen/Qwen2.5-7B-Instruct-GGUF');

  expect(model?.installed).toBe(true);
  expect(model?.installedPath).toBe(installedPath);
});

test('MarketplaceService excludes embedding GGUF records from bundled recommendations', () => {
  const service = new MarketplaceService(() => createTempDir());
  const result = service.searchLocal({ limit: 100 });

  expect(
    result.some(model =>
      /bge|embed|e5|gte|rerank|embedding/i.test(
        [model.repoId, model.name, model.description, ...model.tags].join(' '),
      ),
    ),
  ).toBe(false);
  expect(service.searchLocal({ query: 'bge-large-zh-v1.5', limit: 20 })).toEqual([]);
});

test('MarketplaceService uses the cloud catalogue without sending a local ModelScope token', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.headers).not.toHaveProperty('Authorization');
    return Response.json({ models: [verifiedModel()], totalCount: 593, nextPageNumber: 2 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
  });

  const result = await service.search({ query: 'qwen3', limit: 20, pageNumber: 1 });

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(result.models).toHaveLength(1);
  expect(result.models[0]).toMatchObject({
    repoId: 'Qwen/Qwen3-8B-GGUF',
    capability: 'chat',
    capabilities: ['chat', 'reasoning'],
    metadataStatus: 'verified',
  });
  expect(result.totalCount).toBe(593);
  expect(result.nextPageNumber).toBe(2);
});

test('MarketplaceService keeps live device fit local instead of adding it to the cloud query', async () => {
  const fetchMock = vi.fn(async () => Response.json({ models: [verifiedModel()] }));
  vi.stubGlobal('fetch', fetchMock);
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
  });

  await service.search({ query: 'qwen', fit: 'recommended' });

  const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
  expect(requestedUrl.searchParams.has('fit')).toBe(false);
});

test('MarketplaceService rejects cloud records without checksum-backed GGUF metadata', async () => {
  const invalid = {
    ...verifiedModel('owner/unverified-GGUF'),
    metadataStatus: 'pending',
    files: [],
  };
  const fetchMock = vi.fn(async () => Response.json({ models: [invalid], totalCount: 1 }));
  vi.stubGlobal('fetch', fetchMock);
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
  });

  const result = await service.search({ query: 'unverified' });

  expect(result.models).toEqual([]);
});

test('MarketplaceService filters embedding records even if a malformed cloud response marks them verified', async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      models: [
        { ...verifiedModel('BAAI/bge-large-zh-v1.5-GGUF'), description: 'Embedding model' },
        verifiedModel(),
      ],
      totalCount: 2,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
  });

  const result = await service.search({ query: 'qwen3' });

  expect(result.models.map(model => model.repoId)).toEqual(['Qwen/Qwen3-8B-GGUF']);
});

test('MarketplaceService falls back to bundled recommendations without a token warning', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
  });

  const result = await service.search({ query: 'qwen', limit: 8 });

  expect(result.source).toBe('curated');
  expect(result.warning).toMatch(/^CATALOG_ERROR:/);
  expect(result.warning).not.toMatch(/token|api key/i);
});

test('MarketplaceService resolves install metadata only through the cloud catalogue', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    expect(url).toBe('https://catalog.example.test/v1/catalog/models/Qwen/Qwen3-8B-GGUF');
    return Response.json(verifiedModel());
  });
  vi.stubGlobal('fetch', fetchMock);
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
  });

  const result = await service.resolveModel('Qwen/Qwen3-8B-GGUF');

  expect(result?.filePath).toBe('Qwen3-8B-Q4_K_M.gguf');
  expect(result?.files?.[0]?.sha256).toBe(SHA);
  expect(fetchMock).toHaveBeenCalledOnce();
});
