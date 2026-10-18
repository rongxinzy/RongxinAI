import path from 'path';

import { net } from 'electron';

import { handleIpcContract } from '../ipc/handleIpcContract';
import { marketplaceContract } from '../../shared/marketplace/contract';
import type { MarketplaceSearchParams } from '../../shared/marketplace';
import { MarketplaceService } from '../libs/marketplaceService';

function searchKey(senderId: number, requestId: string): string {
  return `${senderId}:${requestId}`;
}

export function registerMarketplaceIpcHandlers(options: {
  getModelsDir: () => string;
  userDataPath: string;
}): void {
  const service = new MarketplaceService(options.getModelsDir, {
    catalogApiUrl: process.env.ZHIYUAN_MODEL_CATALOG_URL?.trim() || undefined,
    fetchImpl: net.fetch,
    cacheDir: path.join(options.userDataPath, 'marketplace-cache'),
  });
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
        return await service.search(request.params as MarketplaceSearchParams, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) {
          return {
            models: [],
            totalCount: 0,
            source: 'cloud-catalog' as const,
          };
        }
        console.warn('[Marketplace] catalog search failed:', error);
        return {
          models: [],
          totalCount: 0,
          source: 'cloud-catalog' as const,
          warning: '云端 GGUF 目录暂时不可用。',
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
