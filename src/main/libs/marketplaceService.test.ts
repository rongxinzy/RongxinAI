import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import { MarketplaceService } from './marketplaceService';

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-marketplace-'));
  tempDirs.push(dir);
  return dir;
}

test('MarketplaceService marks installed models from the configured llama.cpp models directory', () => {
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
  const model = result.find((item) => item.repoId === 'Qwen/Qwen2.5-7B-Instruct-GGUF');

  expect(model?.installed).toBe(true);
  expect(model?.installedPath).toBe(installedPath);
});

test('MarketplaceService searchLocal defaults to returning at most 100 models', () => {
  const service = new MarketplaceService(() => createTempDir());
  const result = service.searchLocal();

  expect(result.length).toBeLessThanOrEqual(100);
});

test('MarketplaceService GGUF library parser does not stop at 50 items', async () => {
  const module = await import('./marketplaceService');
  const parseModelScopeGgufLibraryHtml = (module as unknown as {
    __test__parseModelScopeGgufLibraryHtml?: (html: string) => string[];
  }).__test__parseModelScopeGgufLibraryHtml;

  expect(typeof parseModelScopeGgufLibraryHtml).toBe('function');
  if (!parseModelScopeGgufLibraryHtml) return;

  const html = Array.from({ length: 120 }, (_, index) =>
    `<a href="/models/owner/model-${index + 1}-GGUF">model ${index + 1}</a>`,
  ).join('\n');

  const result = parseModelScopeGgufLibraryHtml(html);
  expect(result).toHaveLength(120);
});

test('MarketplaceService merges online and curated results without duplicates', async () => {
  const module = await import('./marketplaceService');
  const mergeMarketplaceModels = (module as unknown as {
    __test__mergeMarketplaceModels?: (
      primary: Array<{ id: string; repoId: string; name: string; description: string; tags: string[]; sizes: string[]; recommendedTag: string; capability: 'chat'; installed: false; source: 'modelscope-gguf' }>,
      fallback: Array<{ id: string; repoId: string; name: string; description: string; tags: string[]; sizes: string[]; recommendedTag: string; capability: 'chat'; installed: false; source: 'modelscope-gguf' }>,
      limit: number,
    ) => Array<{ id: string; repoId: string; name: string }>;
  }).__test__mergeMarketplaceModels;

  expect(typeof mergeMarketplaceModels).toBe('function');
  if (!mergeMarketplaceModels) return;

  const result = mergeMarketplaceModels(
    [
      { id: 'a/one', repoId: 'a/one', name: 'one', description: 'one', tags: ['chat'], sizes: ['7B'], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, source: 'modelscope-gguf' },
      { id: 'b/two', repoId: 'b/two', name: 'two', description: 'two', tags: ['chat'], sizes: ['7B'], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, source: 'modelscope-gguf' },
    ],
    [
      { id: 'b/two', repoId: 'b/two', name: 'two', description: 'two', tags: ['chat'], sizes: ['7B'], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, source: 'modelscope-gguf' },
      { id: 'c/three', repoId: 'c/three', name: 'three', description: 'three', tags: ['chat'], sizes: ['7B'], recommendedTag: 'Q4_K_M', capability: 'chat', installed: false, source: 'modelscope-gguf' },
    ],
    10,
  );

  expect(result.map((item) => item.id)).toEqual(['a/one', 'b/two', 'c/three']);
});

test('MarketplaceService sorts featured models first for empty queries and applies filters', () => {
  const service = new MarketplaceService(() => createTempDir());
  const result = service.searchLocal({ task: 'reasoning', size: 'desktop', limit: 20 });

  expect(result.length).toBeGreaterThan(0);
  expect(result.every((item) => item.tags.includes('reasoning') || item.capability === 'reasoning')).toBe(true);
  expect(result[0]?.isFeatured).toBe(true);
});

test('MarketplaceService searches ModelScope OpenAPI with bearer token before legacy API', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toContain('https://modelscope.cn/openapi/v1/models');
    expect(url).toContain('search=qwen3');
    expect(url).toContain('filter.library=gguf');
    expect(url).toContain('sort=downloads');
    expect(url).toContain('page_number=1');
    expect(url).toContain('page_size=50');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    return new Response(JSON.stringify({
      Data: {
        Models: [
          {
            Path: 'Qwen',
            Name: 'Qwen3-8B-GGUF',
            Description: 'Qwen3 GGUF chat model',
            Downloads: 1234,
            Tags: ['text-generation'],
          },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: 'qwen3', limit: 5 });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.models.some(model => model.repoId === 'Qwen/Qwen3-8B-GGUF')).toBe(true);
});

test('MarketplaceService parses ModelScope OpenAPI id fields for GGUF search results', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    expect(url).toContain('search=0.8');
    expect(url).toContain('filter.library=gguf');
    return new Response(JSON.stringify({
      success: true,
      data: {
        models: [
          {
            id: 'QuantFactory/Hathor_Respawn-L3-8B-v0.8-GGUF',
            display_name: 'Hathor_Respawn-L3-8B-v0.8-GGUF',
            description: 'A GGUF model from OpenAPI',
            downloads: 2133,
            tags: ['library:gguf', 'task:text-generation'],
            file_size: 4815162342,
          },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: '0.8', limit: 5 });

  expect(result.models[0]?.repoId).toBe('QuantFactory/Hathor_Respawn-L3-8B-v0.8-GGUF');
  expect(result.models[0]?.downloads).toBe(2133);
});

test('MarketplaceService keeps OpenAPI models tagged as GGUF even when repo id omits GGUF', async () => {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify({
      success: true,
      data: {
        models: [
          {
            id: 'unsloth/Qwen3.6-27B-MTP',
            display_name: 'Qwen3.6-27B-MTP',
            downloads: 12438,
            tags: ['library:gguf', 'task:text-generation'],
          },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: '0.8', limit: 5 });

  expect(result.models.some(model => model.repoId === 'unsloth/Qwen3.6-27B-MTP')).toBe(true);
});

test('MarketplaceService fetches multiple OpenAPI pages when early pages have too few GGUF records', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const page = new URL(url).searchParams.get('page_number');
    return new Response(JSON.stringify({
      success: true,
      data: {
        models: page === '1'
          ? [
            {
              id: 'owner/not-gguf',
              display_name: 'not-gguf',
              downloads: 100,
              tags: ['library:pytorch'],
            },
          ]
          : [
            {
              id: 'owner/page-two-GGUF',
              display_name: 'page-two-GGUF',
              downloads: 90,
              tags: ['library:gguf'],
            },
          ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: '0.8', limit: 60 });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.models.some(model => model.repoId === 'owner/page-two-GGUF')).toBe(true);
});

test('MarketplaceService can request enough OpenAPI pages for large GGUF result sets', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const parsed = new URL(url);
    expect(parsed.searchParams.get('search')).toBe('0.8');
    expect(parsed.searchParams.get('filter.library')).toBe('gguf');
    expect(parsed.searchParams.get('sort')).toBe('downloads');
    expect(parsed.searchParams.get('page_size')).toBe('50');

    const page = Number(parsed.searchParams.get('page_number') ?? '1');
    const start = (page - 1) * 50;
    return new Response(JSON.stringify({
      success: true,
      data: {
        models: Array.from({ length: 50 }, (_, index) => ({
          id: `owner/model-${start + index + 1}-GGUF`,
          display_name: `model-${start + index + 1}-GGUF`,
          downloads: 1000 - start - index,
          tags: ['library:gguf'],
        })),
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: '0.8', limit: 750 });

  expect(fetchMock).toHaveBeenCalledTimes(15);
  expect(result.models).toHaveLength(750);
  expect(result.models.at(-1)?.repoId).toBe('owner/model-750-GGUF');
});

test('MarketplaceService successful online search does not mix in curated models', async () => {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify({
      success: true,
      data: {
        models: [
          {
            id: 'owner/only-search-result-GGUF',
            display_name: 'only-search-result-GGUF',
            downloads: 123,
            tags: ['library:gguf'],
          },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: 'only-search-result', limit: 10 });

  expect(result.models.map(model => model.repoId)).toEqual(['owner/only-search-result-GGUF']);
});

test('MarketplaceService returns OpenAPI total count and next page number for paged loading', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const parsed = new URL(url);
    expect(parsed.searchParams.get('page_number')).toBe('4');
    return new Response(JSON.stringify({
      success: true,
      data: {
        total_count: 1800,
        page_number: 4,
        page_size: 50,
        models: Array.from({ length: 50 }, (_, index) => ({
          id: `owner/paged-${index + 151}-GGUF`,
          display_name: `paged-${index + 151}-GGUF`,
          downloads: 1000 - index,
          tags: ['library:gguf'],
        })),
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: '0.1', limit: 50, pageNumber: 4 });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.models).toHaveLength(50);
  expect(result.totalCount).toBe(1800);
  expect(result.nextPageNumber).toBe(5);
});

test('MarketplaceService does not request beyond the OpenAPI 3000 item page limit', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const parsed = new URL(url);
    expect(parsed.searchParams.get('page_number')).toBe('60');
    return new Response(JSON.stringify({
      success: true,
      data: {
        total_count: 18182,
        page_number: 60,
        page_size: 50,
        models: [
          {
            id: 'owner/page-60-GGUF',
            display_name: 'page-60-GGUF',
            downloads: 1,
            tags: ['library:gguf'],
          },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: '0.1', limit: 50, pageNumber: 60 });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.models.some(model => model.repoId === 'owner/page-60-GGUF')).toBe(true);
  expect(result.nextPageNumber).toBeUndefined();
});

test('MarketplaceService skips OpenAPI requests after the 3000 item page limit', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: '0.1', limit: 50, pageNumber: 61 });

  expect(fetchMock).not.toHaveBeenCalled();
  expect(result.models).toHaveLength(0);
  expect(result.warning).toBeUndefined();
});

test('MarketplaceService returns partial OpenAPI results when a later page fails', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/openapi/v1/models')) {
      const page = new URL(url).searchParams.get('page_number');
      if (page === '2') {
        return new Response('timeout', { status: 503 });
      }
      return new Response(JSON.stringify({
        success: true,
        data: {
          models: Array.from({ length: 50 }, (_, index) => ({
            id: `owner/partial-${index + 1}-GGUF`,
            display_name: `partial-${index + 1}-GGUF`,
            downloads: 100 - index,
            tags: ['library:gguf'],
          })),
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('fallback should not be used after partial OpenAPI results');
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: '0.8', limit: 100 });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.models).toHaveLength(50);
  expect(result.models[0]?.repoId).toBe('owner/partial-1-GGUF');
});

test('MarketplaceService treats empty OpenAPI search results as an empty result, not an error', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (!url.includes('/openapi/v1/models')) {
      throw new Error('fallback should not be used for empty OpenAPI search results');
    }
    return new Response(JSON.stringify({
      success: true,
      data: {
        models: [],
        total_count: 0,
        page_number: 1,
        page_size: 50,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: '0.65', limit: 750 });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.models).toHaveLength(0);
  expect(result.warning).toBeUndefined();
});

test('MarketplaceService retries OpenAPI rate limits with the next token', async () => {
  const tokens = ['first-token', 'second-token'];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!url.includes('/openapi/v1/models')) {
      throw new Error('fallback should not be used after retrying a rate limit');
    }
    if ((init?.headers as Record<string, string> | undefined)?.Authorization === 'Bearer first-token') {
      return new Response('rate limited', { status: 429 });
    }
    return new Response(JSON.stringify({
      success: true,
      data: {
        models: [
          {
            id: 'owner/retried-GGUF',
            display_name: 'retried-GGUF',
            downloads: 99,
            tags: ['library:gguf'],
          },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => tokens.shift() ?? 'second-token',
  });
  const result = await service.search({ query: 'qwen', limit: 5 });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.models.some(model => model.repoId === 'owner/retried-GGUF')).toBe(true);
  expect(fetchMock.mock.calls.map(([, init]) => (init?.headers as Record<string, string>).Authorization)).toEqual([
    'Bearer first-token',
    'Bearer second-token',
  ]);
});

test('MarketplaceService reports OpenAPI failure instead of library page parser fallback failure', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/openapi/v1/models')) {
      return new Response('server error', { status: 503 });
    }
    if (url.includes('/api/v1/models')) {
      return new Response(JSON.stringify({ Data: { Models: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('<html>changed</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'test-token',
  });
  const result = await service.search({ query: '0.8', limit: 5 });

  expect(result.models).toHaveLength(0);
  expect(result.warning).toContain('HTTP 503');
  expect(result.warning).not.toContain('library page structure changed');
});

test('MarketplaceService falls back to legacy search when ModelScope OpenAPI authentication fails', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/openapi/v1/models')) {
      return new Response('unauthorized', { status: 401 });
    }
    expect(url).toContain('https://www.modelscope.cn/api/v1/models');
    expect(url).toContain('Search=qwen2.5');
    return new Response(JSON.stringify({
      Data: {
        Models: [
          {
            Path: 'Qwen',
            Name: 'Qwen2.5-7B-Instruct-GGUF',
            Description: 'legacy GGUF model',
            Downloads: 456,
          },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = new MarketplaceService(() => createTempDir(), {
    getModelScopeToken: () => 'expired-token',
  });
  const result = await service.search({ query: 'qwen2.5', limit: 5 });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.models.some(model => model.repoId === 'Qwen/Qwen2.5-7B-Instruct-GGUF')).toBe(true);
});
