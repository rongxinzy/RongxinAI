import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type {
  MarketplaceModel,
  MarketplaceSearchParams,
  MarketplaceSearchResult,
} from '../../../../shared/marketplace';
import { MARKETPLACE_PREFETCH_PAGE_COUNT } from '../constants';
import { getLocalInferenceUserFacingErrorMessage } from '../utils/errors';
import { buildMarketplaceSearchParams } from '../utils/marketplace';

type MarketplacePageCache = {
  key: string;
  pages: Map<number, MarketplaceSearchResult>;
  // Keep cursor positions for visited pages even when their model data is evicted.
  cursors: Map<number, string | undefined>;
};

function marketplacePageCacheKey(params: MarketplaceSearchParams): string {
  return JSON.stringify({
    query: params.query ?? '',
    tags: params.tags ?? [],
    task: params.task ?? 'all',
    size: params.size ?? 'all',
    limit: params.limit ?? 0,
    device: params.device ?? '',
    featuredOnly: params.featuredOnly ?? false,
    fit: params.fit ?? 'all',
    quantization: params.quantization ?? '',
    minStars: params.minStars ?? null,
  });
}

function hasMarketplaceNextPage(result: MarketplaceSearchResult): boolean {
  return result.hasMore !== false && Boolean(result.nextCursor);
}

type UseMarketplaceSearchResult = {
  marketplaceModels: MarketplaceModel[];
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  marketplaceHasSearched: boolean;
  marketplaceTotalCount: number | undefined;
  marketplaceHasNextPage: boolean;
  marketplaceSearchParams: MarketplaceSearchParams;
  /** Draft query lives in a ref so keystrokes do not re-render sibling UI. */
  marketplaceQueryRef: RefObject<string>;
  marketplaceHasSearchedRef: RefObject<boolean>;
  setMarketplaceHasSearched: (value: boolean) => void;
  searchMarketplace: (params: MarketplaceSearchParams) => Promise<void>;
  clearMarketplaceState: () => void;
  handleMarketplaceSearch: (overrides?: MarketplaceSearchParams) => void;
  handleMarketplaceQueryChange: (value: string) => void;
  markMarketplaceInstalled: (name: string) => void;
  markMarketplaceUninstalled: (modelName: string) => void;
};

/**
 * Owns the marketplace catalog state: the draft query ref, paginated search
 * with a per-query page cache, sequential cursor prefetch, cancellation of
 * in-flight requests on new searches, and unmount.
 */
export function useMarketplaceSearch(): UseMarketplaceSearchResult {
  const [marketplaceModels, setMarketplaceModels] = useState<MarketplaceModel[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [marketplaceHasSearched, setMarketplaceHasSearched] = useState(false);
  const [marketplaceTotalCount, setMarketplaceTotalCount] = useState<number>();
  const [marketplaceHasNextPage, setMarketplaceHasNextPage] = useState(false);
  const [marketplaceSearchParams, setMarketplaceSearchParams] = useState<MarketplaceSearchParams>(
    {},
  );
  const marketplaceSearchRef = useRef<number>(0);
  const marketplaceRequestIdRef = useRef<string | null>(null);
  const marketplacePrefetchRequestIdsRef = useRef<Set<string>>(new Set());
  const marketplacePageCacheRef = useRef<MarketplacePageCache | null>(null);
  // The marketplace panel owns the draft query state; the view only keeps a ref
  // so keystrokes do not re-render the models grid and sibling UI.
  const marketplaceQueryRef = useRef('');
  const marketplaceHasSearchedRef = useRef(marketplaceHasSearched);

  const cancelMarketplacePrefetches = useCallback(() => {
    const requestIds = Array.from(marketplacePrefetchRequestIdsRef.current);
    marketplacePrefetchRequestIdsRef.current.clear();
    requestIds.forEach(requestId => {
      void window.electron.marketplace.cancelSearch(requestId).catch(() => undefined);
    });
  }, []);

  const preloadMarketplacePage = useCallback(
    async (
      cacheKey: string,
      params: MarketplaceSearchParams,
      currentResult: MarketplaceSearchResult,
      searchId: number,
    ) => {
      const cache = marketplacePageCacheRef.current;
      if (!cache || cache.key !== cacheKey) return;
      const currentPage = params.pageNumber ?? 1;
      let nextPage = currentPage + 1;
      let nextCursor = hasMarketplaceNextPage(currentResult) ? currentResult.nextCursor : undefined;

      // Cursor pagination is sequential: the second prefetched page can only be
      // requested after the first prefetched response provides its next cursor.
      for (let offset = 0; offset < MARKETPLACE_PREFETCH_PAGE_COUNT && nextCursor; offset += 1) {
        cache.cursors.set(nextPage, nextCursor);
        const cachedNextResult = cache.pages.get(nextPage);
        if (cachedNextResult) {
          if (!hasMarketplaceNextPage(cachedNextResult)) break;
          nextCursor = cachedNextResult.nextCursor;
          nextPage += 1;
          continue;
        }

        const requestId =
          globalThis.crypto?.randomUUID?.() ??
          `marketplace-prefetch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        marketplacePrefetchRequestIdsRef.current.add(requestId);
        try {
          const nextResult = await window.electron.marketplace.search({
            requestId,
            params: { ...params, pageNumber: nextPage, cursor: nextCursor },
          });
          if (searchId !== marketplaceSearchRef.current) return;
          const currentCache = marketplacePageCacheRef.current;
          if (!currentCache || currentCache.key !== cacheKey) return;
          currentCache.pages.set(nextPage, nextResult);
          if (!hasMarketplaceNextPage(nextResult)) break;
          nextCursor = nextResult.nextCursor;
          nextPage += 1;
        } catch {
          // Prefetch is best effort. The page will be fetched when requested.
          break;
        } finally {
          marketplacePrefetchRequestIdsRef.current.delete(requestId);
        }
      }

      const currentCache = marketplacePageCacheRef.current;
      if (!currentCache || currentCache.key !== cacheKey) return;
      const lastPrefetchedPage = currentPage + MARKETPLACE_PREFETCH_PAGE_COUNT;
      for (const pageNumber of currentCache.pages.keys()) {
        if (pageNumber < currentPage || pageNumber > lastPrefetchedPage) {
          currentCache.pages.delete(pageNumber);
        }
      }
    },
    [],
  );

  const searchMarketplace = useCallback(
    async (params: MarketplaceSearchParams) => {
      const id = ++marketplaceSearchRef.current;
      const cacheKey = marketplacePageCacheKey(params);
      cancelMarketplacePrefetches();
      if (!marketplacePageCacheRef.current || marketplacePageCacheRef.current.key !== cacheKey) {
        marketplacePageCacheRef.current = { key: cacheKey, pages: new Map(), cursors: new Map() };
      }
      const pageNumber = params.pageNumber ?? 1;
      const cache = marketplacePageCacheRef.current;
      const cursor = pageNumber > 1 ? cache?.cursors.get(pageNumber) : undefined;
      if (pageNumber > 1 && !cursor) {
        setMarketplaceLoading(false);
        return;
      }
      const requestParams = pageNumber > 1 ? { ...params, cursor } : params;
      const cachedResult = pageNumber > 1 ? cache?.pages.get(pageNumber) : undefined;
      if (cachedResult) {
        setMarketplaceSearchParams(params);
        setMarketplaceModels(cachedResult.models);
        if (pageNumber <= 1) {
          setMarketplaceTotalCount(cachedResult.totalCount);
        }
        setMarketplaceHasNextPage(hasMarketplaceNextPage(cachedResult));
        setMarketplaceError(cachedResult.warning ?? null);
        setMarketplaceLoading(false);
        void preloadMarketplacePage(cacheKey, requestParams, cachedResult, id);
        return;
      }
      const requestId =
        globalThis.crypto?.randomUUID?.() ??
        `marketplace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      marketplaceRequestIdRef.current = requestId;
      setMarketplaceLoading(true);
      setMarketplaceError(null);
      try {
        const result = await window.electron.marketplace.search({
          requestId,
          params: requestParams,
        });
        if (id === marketplaceSearchRef.current) {
          cache?.pages.set(pageNumber, result);
          cache?.cursors.set(pageNumber, cursor);
          const nextPage = hasMarketplaceNextPage(result) ? pageNumber + 1 : undefined;
          if (cache && nextPage && result.nextCursor) {
            cache.cursors.set(nextPage, result.nextCursor);
            const lastPrefetchedPage = pageNumber + MARKETPLACE_PREFETCH_PAGE_COUNT;
            for (const cachedPage of cache.pages.keys()) {
              if (cachedPage < pageNumber || cachedPage > lastPrefetchedPage) {
                cache.pages.delete(cachedPage);
              }
            }
          }
          setMarketplaceSearchParams(params);
          setMarketplaceModels(result.models);
          if (pageNumber <= 1) {
            setMarketplaceTotalCount(result.totalCount);
          }
          setMarketplaceHasNextPage(hasMarketplaceNextPage(result));
          setMarketplaceError(result.warning ?? null);
          void preloadMarketplacePage(cacheKey, requestParams, result, id);
        }
      } catch (searchError) {
        if (id === marketplaceSearchRef.current) {
          setMarketplaceHasNextPage(false);
          setMarketplaceError(getLocalInferenceUserFacingErrorMessage(searchError));
        }
      } finally {
        if (id === marketplaceSearchRef.current) {
          setMarketplaceLoading(false);
        }
        if (marketplaceRequestIdRef.current === requestId) {
          marketplaceRequestIdRef.current = null;
        }
      }
    },
    [cancelMarketplacePrefetches, preloadMarketplacePage],
  );

  const clearMarketplaceState = useCallback(() => {
    marketplaceSearchRef.current += 1;
    cancelMarketplacePrefetches();
    marketplacePageCacheRef.current = null;
    const requestId = marketplaceRequestIdRef.current;
    marketplaceRequestIdRef.current = null;
    if (requestId) {
      void window.electron.marketplace.cancelSearch(requestId).catch(() => undefined);
    }
    setMarketplaceLoading(false);
    setMarketplaceError(null);
    setMarketplaceModels([]);
    setMarketplaceHasSearched(false);
    setMarketplaceTotalCount(undefined);
    setMarketplaceHasNextPage(false);
    setMarketplaceSearchParams({});
  }, [cancelMarketplacePrefetches]);

  const handleMarketplaceSearch = useCallback(
    (overrides: MarketplaceSearchParams = {}) => {
      const params = buildMarketplaceSearchParams({
        ...overrides,
        query: overrides.query ?? marketplaceQueryRef.current,
      });
      if (!params) {
        clearMarketplaceState();
        return;
      }
      setMarketplaceHasSearched(true);
      void searchMarketplace(params);
    },
    [clearMarketplaceState, searchMarketplace],
  );

  const handleMarketplaceQueryChange = useCallback((value: string) => {
    marketplaceQueryRef.current = value;
  }, []);

  const markMarketplaceInstalled = useCallback((name: string) => {
    setMarketplaceModels(prev =>
      prev.map(m => (m.repoId === name ? { ...m, installed: true } : m)),
    );
  }, []);

  const markMarketplaceUninstalled = useCallback((modelName: string) => {
    setMarketplaceModels(prev =>
      prev.map(m => {
        const repoName = m.repoId.split('/').pop();
        return repoName === modelName ? { ...m, installed: false } : m;
      }),
    );
  }, []);

  useEffect(() => {
    marketplaceHasSearchedRef.current = marketplaceHasSearched;
  }, [marketplaceHasSearched]);

  useEffect(() => {
    return () => {
      cancelMarketplacePrefetches();
      const requestId = marketplaceRequestIdRef.current;
      if (requestId) {
        void window.electron.marketplace.cancelSearch(requestId).catch(() => undefined);
      }
    };
  }, [cancelMarketplacePrefetches]);

  return {
    marketplaceModels,
    marketplaceLoading,
    marketplaceError,
    marketplaceHasSearched,
    marketplaceTotalCount,
    marketplaceHasNextPage,
    marketplaceSearchParams,
    marketplaceQueryRef,
    marketplaceHasSearchedRef,
    setMarketplaceHasSearched,
    searchMarketplace,
    clearMarketplaceState,
    handleMarketplaceSearch,
    handleMarketplaceQueryChange,
    markMarketplaceInstalled,
    markMarketplaceUninstalled,
  };
}
