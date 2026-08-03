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

function expireCacheEntries(cacheDir: string): void {
  for (const name of fs.readdirSync(cacheDir)) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(cacheDir, name);
    const entry = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { cachedAt: number };
    entry.cachedAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
    fs.writeFileSync(filePath, JSON.stringify(entry), 'utf8');
  }
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

test('MarketplaceService marks installed models from the configured local-model directory', async () => {
  const modelsDir = createTempDir();
  const installedPath = path.join(
    modelsDir,
    'modelscope',
    'Qwen',
    'Qwen3-8B-GGUF',
    'qwen3-8b-q4_k_m.gguf',
  );
  fs.mkdirSync(path.dirname(installedPath), { recursive: true });
  fs.writeFileSync(installedPath, '');

  const fetchMock = vi.fn(async () =>
    Response.json({ models: [verifiedModel()], totalCount: 1 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const service = new MarketplaceService(() => modelsDir, {
    catalogApiUrl: 'https://catalog.example.test',
  });

  const result = await service.search({ limit: 10 });
  const model = result.models.find(item => item.repoId === 'Qwen/Qwen3-8B-GGUF');

  expect(model?.installed).toBe(true);
  expect(model?.installedPath).toBe(installedPath);
});

test('MarketplaceService returns an empty result with a warning when the catalogue is down and uncached', async () => {
  const fetchMock = vi.fn(async () => {
    throw new Error('network unreachable');
  });
  vi.stubGlobal('fetch', fetchMock);
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
  });

  const result = await service.search({ query: 'qwen3', limit: 20 });

  expect(result.models).toHaveLength(0);
  expect(result.totalCount).toBe(0);
  expect(result.warning).toMatch(/CATALOG_ERROR/);
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

test('MarketplaceService sends unrestricted browse requests to the cloud catalogue', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    expect(url).toBe('https://catalog.example.test/v1/catalog/search?limit=8&page=1');
    return Response.json({ models: [verifiedModel()], totalCount: 593, nextPageNumber: 2 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
  });

  const result = await service.search({
    limit: 8,
    pageNumber: 1,
    featuredOnly: false,
  });

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(result.source).toBe('cloud-catalog');
  expect(result.models).toHaveLength(1);
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

test('MarketplaceService reports catalogue failures without leaking token details', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
  });

  const result = await service.search({ query: 'qwen', limit: 8 });

  expect(result.source).toBe('cloud-catalog');
  expect(result.models).toHaveLength(0);
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

test('MarketplaceService serves repeated searches from the disk cache', async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ models: [verifiedModel()], totalCount: 593, nextPageNumber: 2 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
    cacheDir: createTempDir(),
  });

  await service.search({ query: 'qwen3', limit: 20, pageNumber: 1 });
  const second = await service.search({ query: 'qwen3', limit: 20, pageNumber: 1 });

  // The second call is answered from disk without hitting the network.
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(second.models).toHaveLength(1);
  expect(second.totalCount).toBe(593);
});

test('MarketplaceService falls back to a stale cached search when the catalogue is down', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ models: [verifiedModel()], totalCount: 593, nextPageNumber: 2 }),
    )
    .mockRejectedValueOnce(new Error('network unreachable'));
  vi.stubGlobal('fetch', fetchMock);
  const cacheDir = createTempDir();
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
    cacheDir,
  });

  await service.search({ query: 'qwen3', limit: 20, pageNumber: 1 });
  expireCacheEntries(cacheDir);
  const result = await service.search({ query: 'qwen3', limit: 20, pageNumber: 1 });

  expect(result.models).toHaveLength(1);
  expect(result.warning).toMatch(/缓存/);
  expect(result.source).toBe('cloud-catalog');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('MarketplaceService caches resolved model details and serves them offline', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ model: verifiedModel() }))
    .mockRejectedValueOnce(new Error('network unreachable'));
  vi.stubGlobal('fetch', fetchMock);
  const cacheDir = createTempDir();
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
    cacheDir,
  });

  const first = await service.resolveModel('Qwen/Qwen3-8B-GGUF');
  expireCacheEntries(cacheDir);
  const second = await service.resolveModel('Qwen/Qwen3-8B-GGUF');

  expect(first?.repoId).toBe('Qwen/Qwen3-8B-GGUF');
  expect(second?.repoId).toBe('Qwen/Qwen3-8B-GGUF');
  expect(fetchMock).toHaveBeenCalledTimes(2); // fresh hit + failed refresh fallback
});

test('MarketplaceService works without a cache directory', async () => {
  const fetchMock = vi.fn(async () => Response.json({ models: [verifiedModel()] }));
  vi.stubGlobal('fetch', fetchMock);
  const service = new MarketplaceService(() => createTempDir(), {
    catalogApiUrl: 'https://catalog.example.test',
  });

  await service.search({ query: 'qwen3' });
  await service.search({ query: 'qwen3' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
