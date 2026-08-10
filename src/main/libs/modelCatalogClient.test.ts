import { expect, test, vi } from 'vitest';

import { MarketplaceDeviceProfile } from '../../shared/marketplace';
import { ModelCatalogClient } from './modelCatalogClient';

const VERIFIED_SHA = 'a'.repeat(64);

test('uses the search endpoint without sending the legacy featured query', async () => {
  let requestedUrl = '';
  const fetchMock = vi.fn(async (input: string | Request) => {
    requestedUrl = String(input);
    return Response.json({
      models: [
        {
          id: 'Qwen/Qwen3-8B-GGUF',
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
    });
  });

  const client = new ModelCatalogClient('https://catalog.example.test', fetchMock);
  await client.search({
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
  expect(url.searchParams.has('featured')).toBe(false);
});
