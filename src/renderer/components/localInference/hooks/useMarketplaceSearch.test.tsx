// @vitest-environment jsdom
import { act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import type {
  MarketplaceModel,
  MarketplaceSearchParams,
  MarketplaceSearchResult,
} from '../../../../shared/marketplace';
import { MARKETPLACE_PAGE_SIZE } from '../constants';
import { useMarketplaceSearch } from './useMarketplaceSearch';

const model = (id: string): MarketplaceModel =>
  ({
    source: 'modelscopes-gguf-mock',
    id,
    repoId: `Qwen/${id}-GGUF`,
    name: id,
    description: '',
    tags: [],
    sizes: [],
    recommendedTag: '',
    capability: 'chat',
    installed: false,
  }) as unknown as MarketplaceModel;

const page = (name: string, count: number, nextCursor?: string): MarketplaceSearchResult => ({
  models: Array.from({ length: count }, (_, index) => model(`${name}-${index}`)),
  totalCount: 100,
  hasMore: Boolean(nextCursor),
  nextCursor,
});

type SearchCall = { requestId: string; params: MarketplaceSearchParams };

const mocks = vi.hoisted(() => ({
  search: vi.fn<(request: SearchCall) => Promise<MarketplaceSearchResult>>(),
  cancelSearch: vi.fn<(requestId: string) => Promise<void>>(),
}));

beforeEach(() => {
  mocks.search.mockReset();
  mocks.cancelSearch.mockReset().mockResolvedValue(undefined);
  window.electron = {
    marketplace: {
      search: mocks.search,
      cancelSearch: mocks.cancelSearch,
    },
  } as unknown as typeof window.electron;
});

const flush = () =>
  new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });

test('searches page 1, then prefetches the next pages sequentially by cursor', async () => {
  mocks.search.mockImplementation(async request => {
    const pageNumber = request.params.pageNumber ?? 1;
    if (pageNumber === 1) return page('one', MARKETPLACE_PAGE_SIZE, 'cursor-2');
    if (pageNumber === 2) return page('two', MARKETPLACE_PAGE_SIZE, 'cursor-3');
    return page('three', MARKETPLACE_PAGE_SIZE);
  });

  const { result } = renderHook(() => useMarketplaceSearch());
  await act(async () => {
    await result.current.searchMarketplace({ query: 'qwen', limit: MARKETPLACE_PAGE_SIZE });
  });

  expect(result.current.marketplaceModels).toHaveLength(MARKETPLACE_PAGE_SIZE);
  expect(result.current.marketplaceHasNextPage).toBe(true);
  expect(result.current.marketplaceTotalCount).toBe(100);
  expect(result.current.marketplaceLoading).toBe(false);
  expect(result.current.marketplaceError).toBeNull();

  // Page 1 plus the two sequential prefetch pages (cursor pagination).
  await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(3));
  expect(mocks.search.mock.calls.map(call => call[0].params.pageNumber ?? 1)).toEqual([1, 2, 3]);
  expect(mocks.search.mock.calls[1]?.[0].params.cursor).toBe('cursor-2');
  expect(mocks.search.mock.calls[2]?.[0].params.cursor).toBe('cursor-3');
});

test('serves a later page from the prefetch cache without another request', async () => {
  mocks.search.mockImplementation(async request => {
    const pageNumber = request.params.pageNumber ?? 1;
    if (pageNumber === 1) return page('one', MARKETPLACE_PAGE_SIZE, 'cursor-2');
    return page('two', MARKETPLACE_PAGE_SIZE);
  });
  const { result } = renderHook(() => useMarketplaceSearch());
  await act(async () => {
    await result.current.searchMarketplace({ query: 'qwen', limit: MARKETPLACE_PAGE_SIZE });
  });
  await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
  mocks.search.mockClear();

  await act(async () => {
    await result.current.searchMarketplace({
      query: 'qwen',
      limit: MARKETPLACE_PAGE_SIZE,
      pageNumber: 2,
    });
  });

  expect(mocks.search).not.toHaveBeenCalled();
  expect(result.current.marketplaceModels.map(m => m.id)).toEqual([
    'two-0',
    'two-1',
    'two-2',
    'two-3',
    'two-4',
    'two-5',
    'two-6',
    'two-7',
  ]);
  // Page 2 is not page 1, so the total count stays untouched.
  expect(result.current.marketplaceTotalCount).toBe(100);
  expect(result.current.marketplaceLoading).toBe(false);
});

test('walking cached pages records further cursors and prefetches page 4', async () => {
  mocks.search.mockImplementation(async request => {
    const pageNumber = request.params.pageNumber ?? 1;
    if (pageNumber === 1) return page('one', MARKETPLACE_PAGE_SIZE, 'cursor-2');
    if (pageNumber === 2) return page('two', MARKETPLACE_PAGE_SIZE, 'cursor-3');
    if (pageNumber === 3) return page('three', MARKETPLACE_PAGE_SIZE, 'cursor-4');
    return page('four', MARKETPLACE_PAGE_SIZE);
  });
  const { result } = renderHook(() => useMarketplaceSearch());
  await act(async () => {
    await result.current.searchMarketplace({ query: 'qwen', limit: MARKETPLACE_PAGE_SIZE });
  });
  await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(3));

  // Page 2 comes from the cache; its prefetch walks the cached page 3 and
  // fetches page 4 with the cursor page 3 remembered for it.
  await act(async () => {
    await result.current.searchMarketplace({
      query: 'qwen',
      limit: MARKETPLACE_PAGE_SIZE,
      pageNumber: 2,
    });
  });
  await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(4));
  expect(mocks.search.mock.calls[3]?.[0].params).toMatchObject({
    pageNumber: 4,
    cursor: 'cursor-4',
  });
  mocks.search.mockClear();

  await act(async () => {
    await result.current.searchMarketplace({
      query: 'qwen',
      limit: MARKETPLACE_PAGE_SIZE,
      pageNumber: 4,
    });
  });

  expect(mocks.search).not.toHaveBeenCalled();
  expect(result.current.marketplaceModels.map(m => m.id)).toContain('four-0');
});

test('refuses to fetch a page whose cursor was never recorded', async () => {
  mocks.search.mockImplementation(async request => {
    const pageNumber = request.params.pageNumber ?? 1;
    if (pageNumber === 1) return page('one', MARKETPLACE_PAGE_SIZE, 'cursor-2');
    if (pageNumber === 2) return page('two', MARKETPLACE_PAGE_SIZE, 'cursor-3');
    return page('three', MARKETPLACE_PAGE_SIZE, 'cursor-4');
  });
  const { result } = renderHook(() => useMarketplaceSearch());
  await act(async () => {
    await result.current.searchMarketplace({ query: 'qwen', limit: MARKETPLACE_PAGE_SIZE });
  });
  // Page 1 search plus prefetch of pages 2 and 3; the cursor for page 4 is
  // only recorded once page 3 becomes the requested page, not a prefetch.
  await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(3));
  mocks.search.mockClear();

  await act(async () => {
    await result.current.searchMarketplace({
      query: 'qwen',
      limit: MARKETPLACE_PAGE_SIZE,
      pageNumber: 4,
    });
  });

  expect(mocks.search).not.toHaveBeenCalled();
  expect(result.current.marketplaceLoading).toBe(false);
  // The visible models are untouched by the refused page.
  expect(result.current.marketplaceModels.map(m => m.id)).toEqual([
    'one-0',
    'one-1',
    'one-2',
    'one-3',
    'one-4',
    'one-5',
    'one-6',
    'one-7',
  ]);
});

test('clearMarketplaceState cancels the in-flight request and resets the catalog', async () => {
  let releaseSearch: ((result: MarketplaceSearchResult) => void) | undefined;
  mocks.search.mockImplementation(
    request =>
      new Promise(resolve => {
        if ((request.params.pageNumber ?? 1) === 1) {
          releaseSearch = resolve;
        } else {
          resolve(page('prefetch', 1));
        }
      }),
  );
  const { result } = renderHook(() => useMarketplaceSearch());
  act(() => {
    void result.current.searchMarketplace({ query: 'qwen', limit: MARKETPLACE_PAGE_SIZE });
  });
  await waitFor(() => expect(mocks.search).toHaveBeenCalled());
  expect(result.current.marketplaceLoading).toBe(true);

  act(() => {
    result.current.markMarketplaceInstalled('Qwen/one-0-GGUF');
    result.current.clearMarketplaceState();
  });

  expect(result.current.marketplaceLoading).toBe(false);
  expect(result.current.marketplaceModels).toHaveLength(0);
  expect(result.current.marketplaceHasSearched).toBe(false);
  expect(result.current.marketplaceHasNextPage).toBe(false);
  expect(result.current.marketplaceSearchParams).toEqual({});
  const requestId = mocks.search.mock.calls[0]?.[0].requestId;
  expect(requestId).toBeTruthy();
  expect(mocks.cancelSearch).toHaveBeenCalledWith(requestId);

  await act(async () => {
    releaseSearch?.(page('late', 1));
    await flush();
  });
  // The stale response for a cleared search is ignored.
  expect(result.current.marketplaceModels).toHaveLength(0);
});

test('handleMarketplaceSearch uses the draft query and clears state on unusable input', async () => {
  mocks.search.mockResolvedValue(page('one', MARKETPLACE_PAGE_SIZE));
  const { result } = renderHook(() => useMarketplaceSearch());

  act(() => {
    result.current.handleMarketplaceQueryChange(' qwen ');
  });
  await act(async () => {
    result.current.handleMarketplaceSearch();
  });
  await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(1));
  expect(mocks.search.mock.calls[0]?.[0].params).toMatchObject({
    query: 'qwen',
    limit: MARKETPLACE_PAGE_SIZE,
  });
  expect(result.current.marketplaceHasSearched).toBe(true);

  await act(async () => {
    result.current.handleMarketplaceSearch({ query: ' / ' });
  });
  expect(result.current.marketplaceHasSearched).toBe(false);
  expect(result.current.marketplaceModels).toHaveLength(0);
  expect(mocks.search).toHaveBeenCalledTimes(1);
});

test('installed flags flip by repo id and by final path segment', async () => {
  mocks.search.mockResolvedValue({
    models: [model('a'), model('b')],
    totalCount: 2,
    hasMore: false,
  });
  const { result } = renderHook(() => useMarketplaceSearch());
  await act(async () => {
    await result.current.searchMarketplace({ query: 'qwen' });
  });

  act(() => {
    result.current.markMarketplaceInstalled('Qwen/a-GGUF');
  });
  expect(result.current.marketplaceModels.map(m => m.installed)).toEqual([true, false]);

  act(() => {
    result.current.markMarketplaceUninstalled('b-GGUF');
  });
  expect(result.current.marketplaceModels.map(m => m.installed)).toEqual([true, false]);

  act(() => {
    result.current.markMarketplaceUninstalled('a-GGUF');
  });
  expect(result.current.marketplaceModels.map(m => m.installed)).toEqual([false, false]);
});
