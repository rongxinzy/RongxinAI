import { expect, test, vi } from 'vitest';

import { MarketplaceDeviceProfile } from '../../shared/marketplace';
import { ModelCatalogClient } from './modelCatalogClient';

const VERIFIED_SHA = 'a'.repeat(64);

test('uses the search endpoint without sending the legacy featured query', async () => {
  let requestedUrl = '';
  const fetchMock = vi.fn(async (input: string | Request) => {
    requestedUrl = String(input);
    return Response.json({
      source: 'd1',
      models: [
        {
          id: 'Qwen/Qwen3-8B-GGUF',
          repoId: 'Qwen/Qwen3-8B-GGUF',
          name: 'Qwen3 8B GGUF',
          parameterCount: 8,
          publishedAt: '2025-01-02T03:04:05.000Z',
          files: [
            {
              path: 'Qwen3-8B-Q4_K_M.gguf',
              isRecommended: true,
              sizeBytes: 100,
              sha256: VERIFIED_SHA,
            },
          ],
          metadataStatus: 'verified',
          runtime: { format: 'gguf', ggufFilesVerified: true },
        },
      ],
      totalCount: 1,
    });
  });

  const client = new ModelCatalogClient('https://catalog.example.test', fetchMock);
  const result = await client.search({
    device: MarketplaceDeviceProfile.Pro,
    featuredOnly: true,
    limit: 8,
    pageNumber: 2,
    cursor: 'opaque cursor',
  });

  const url = new URL(requestedUrl);
  expect(url.pathname).toBe('/v1/catalog/search');
  expect(url.searchParams.get('limit')).toBe('8');
  expect(url.searchParams.has('page')).toBe(false);
  expect(url.searchParams.get('cursor')).toBe('opaque cursor');
  expect(url.searchParams.get('device')).toBe(MarketplaceDeviceProfile.Pro);
  expect(url.searchParams.get('fit')).toBeNull();
  expect(url.searchParams.has('sortby')).toBe(false);
  expect(url.searchParams.has('featured')).toBe(false);
  expect(result.source).toBe('d1');
  expect(result.models[0]).toMatchObject({
    parameterCount: 8,
    publishedAt: '2025-01-02T03:04:05.000Z',
  });
});

test('maps the local compatible fit filter to the catalogue runnable filter', async () => {
  let requestedUrl = '';
  const fetchMock = vi.fn(async (input: string | Request) => {
    requestedUrl = String(input);
    return Response.json({ models: [] });
  });

  const client = new ModelCatalogClient('https://catalog.example.test', fetchMock);
  await client.search({ fit: 'compatible', limit: 8 });

  expect(new URL(requestedUrl).searchParams.get('fit')).toBe('runnable');
});

test('resolveModel matches repo ids case-insensitively and aliases by model id', async () => {
  const fetchMock = vi.fn(async () => Response.json({
    models: [
      {
        id: 'qwen3-8b-gguf',
        repoId: 'Qwen/Qwen3-8B-GGUF',
        name: 'Qwen3 8B GGUF',
        files: [
          {
            path: 'Qwen3-8B-Q4_K_M.gguf',
            isRecommended: true,
            sizeBytes: 100,
            sha256: VERIFIED_SHA,
          },
        ],
        metadataStatus: 'verified',
        runtime: { format: 'gguf', ggufFilesVerified: true },
      },
    ],
    totalCount: 1,
  }));

  const client = new ModelCatalogClient('https://catalog.example.test', fetchMock);

  await expect(client.resolveModel('qwen/qwen3-8b-gguf')).resolves.toMatchObject({
    repoId: 'Qwen/Qwen3-8B-GGUF',
  });
  await expect(client.resolveModel('qwen3-8b-gguf')).resolves.toMatchObject({
    id: 'qwen3-8b-gguf',
  });
});
