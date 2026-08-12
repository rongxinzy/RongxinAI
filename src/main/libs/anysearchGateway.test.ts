import { afterEach, expect, test, vi } from 'vitest';

import { searchAnySearchGateway } from './anysearchGateway';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('parses results from the AnySearch data envelope', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        code: 200,
        message: 'success',
        data: {
          results: [
            {
              title: 'AnySearch',
              url: 'https://www.anysearch.com',
              snippet: 'Search result',
              content: 'Result content',
            },
          ],
          metadata: { request_id: 'upstream-request' },
        },
        gateway_request_id: 'gateway-request',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(searchAnySearchGateway({ query: 'AnySearch docs', maxResults: 5 })).resolves.toEqual(
    {
      query: 'AnySearch docs',
      results: [
        {
          title: 'AnySearch',
          url: 'https://www.anysearch.com',
          snippet: 'Search result',
          content: 'Result content',
        },
      ],
    },
  );
});

test('accepts legacy top-level results as a compatibility fallback', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              url: 'https://example.com',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );

  await expect(searchAnySearchGateway({ query: 'legacy response' })).resolves.toEqual({
    query: 'legacy response',
    results: [
      {
        title: 'https://example.com',
        url: 'https://example.com',
        snippet: '',
      },
    ],
  });
});
