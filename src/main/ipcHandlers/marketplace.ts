import { net } from 'electron';

import { handleIpcContract } from '../ipc/handleIpcContract';
import { marketplaceContract } from '../../shared/marketplace/contract';
import type { MarketplaceSearchParams } from '../../shared/marketplace';
import { MarketplaceService } from '../libs/marketplaceService';
import { getAppLocalModelCatalog } from '../libs/appLocalModelCatalog';
import { createModelCatalogUpdateCheck } from '../libs/modelCatalogSync';
import { resolveModelCatalogUrl } from '../libs/modelCatalogClient';

function searchKey(senderId: number, requestId: string): string {
  return `${senderId}:${requestId}`;
}

export function registerMarketplaceIpcHandlers(options: {
  getModelsDir: () => string;
  userDataPath: string;
}): void {
  const localCatalog = getAppLocalModelCatalog(options.userDataPath);
  const service = new MarketplaceService(options.getModelsDir, { localCatalog });
  const catalogUrl = resolveModelCatalogUrl();
  const feedUrl =
    process.env.ZHIYUAN_MODEL_CATALOG_FEED_URL?.trim() ||
    (catalogUrl ? `${catalogUrl}/v1/catalog/feed` : undefined);
  const checkForUpdate = feedUrl
    ? createModelCatalogUpdateCheck(localCatalog, feedUrl, net.fetch)
    : undefined;
  const activeSearches = new Map<string, AbortController>();

  handleIpcContract(marketplaceContract, {
    search: async (event, request) => {
      const requestId = request.requestId.trim();
      const key = searchKey(event.sender.id, requestId);
      for (const [activeKey, controller] of activeSearches) {
        if (activeKey.startsWith(`${event.sender.id}:`) && activeKey !== key) {
          controller.abort();
          activeSearches.delete(activeKey);
        }
      }
      const controller = new AbortController();
      activeSearches.set(key, controller);
      try {
        const result = await service.search(
          request.params as MarketplaceSearchParams,
          controller.signal,
        );
        checkForUpdate?.();
        return result;
      } catch (error) {
        if (controller.signal.aborted) {
          return {
            models: [],
            totalCount: 0,
            source: 'local-sqlite' as const,
          };
        }
        console.warn('[Marketplace] catalog search failed:', error);
        return {
          models: [],
          totalCount: 0,
          source: 'local-sqlite' as const,
          warning: '本地模型目录暂时不可用。',
        };
      } finally {
        if (activeSearches.get(key) === controller) activeSearches.delete(key);
      }
    },

    cancelSearch: (event, requestId) => {
      const normalizedRequestId = requestId.trim();
      if (!normalizedRequestId) return { cancelled: false };
      const key = searchKey(event.sender.id, normalizedRequestId);
      const controller = activeSearches.get(key);
      if (!controller) return { cancelled: false };
      controller.abort();
      activeSearches.delete(key);
      return { cancelled: true };
    },
  });
}
