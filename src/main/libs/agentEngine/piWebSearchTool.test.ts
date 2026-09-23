import { afterEach, expect, test, vi } from 'vitest';
import { buildPiWebSearchTool, PiWebSearchSystemPrompt } from './piWebSearchTool';
import { collectPiSystemPromptContributions } from './piSystemPromptContributions';

vi.mock('../anysearchGatewayCredentials', () => ({
  resolveAnySearchGatewayUrl: () => 'https://search.example.invalid/',
  resolveAnySearchGatewayToken: () => 'test-token',
}));
afterEach(() => vi.unstubAllGlobals());

test('searches the gateway and returns bounded, citable results', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      data: {
        results: [
          { title: 'Source', url: 'https://example.com/source', snippet: 'Evidence' },
          { title: 'Invalid', url: 'javascript:alert(1)' },
        ],
      },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const result = await buildPiWebSearchTool().execute('call', { query: ' query ', maxResults: 2 });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://search.example.invalid/v1/search',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ query: 'query', max_results: 2 }),
      headers: expect.objectContaining({ authorization: 'Bearer test-token' }),
    }),
  );
  expect(result.details).toEqual({
    query: 'query',
    results: [{ title: 'Source', url: 'https://example.com/source', snippet: 'Evidence' }],
  });
  expect(result.content[0].text).not.toContain('test-token');
});

test('propagates cancellation and does not start cancelled requests', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  controller.abort();
  await expect(
    buildPiWebSearchTool().execute('call', { query: 'query' }, controller.signal),
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([401, 429, 500])('reports HTTP %s without exposing the response body', async status => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('private gateway details', { status })),
  );
  await expect(buildPiWebSearchTool().execute('call', { query: 'query' })).rejects.toThrow(
    String(status),
  );
});

test.each(['{}', '{invalid', 'x'.repeat(128 * 1024 + 1)])(
  'rejects malformed or oversized gateway responses',
  async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    await expect(buildPiWebSearchTool().execute('call', { query: 'query' })).rejects.toThrow();
  },
);

test('returns zero results explicitly instead of fabricating evidence', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { results: [] } })));
  expect(
    (await buildPiWebSearchTool().execute('call', { query: 'query' })).details.results,
  ).toEqual([]);
});

test('rejects invalid input before sending a request', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    buildPiWebSearchTool().execute('call', { query: ' ', maxResults: 5 }),
  ).rejects.toThrow();
  await expect(
    buildPiWebSearchTool().execute('call', { query: 'query', maxResults: 11 }),
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('adds the search policy to Chat only', () => {
  const context = { fileToolsEnabled: true, maxOutputTokens: 8000 };
  expect(collectPiSystemPromptContributions({ ...context, chatMode: true })).toContain(
    PiWebSearchSystemPrompt,
  );
  expect(collectPiSystemPromptContributions({ ...context, chatMode: false })).not.toContain(
    PiWebSearchSystemPrompt,
  );
});
