import { ipcMain, net } from 'electron';
import path from 'path';

import {
  MarketplaceIpcChannel,
  type MarketplaceSearchRequest,
} from '../../shared/marketplace';
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

  ipcMain.handle(MarketplaceIpcChannel.Search, async (event, request: MarketplaceSearchRequest) => {
    const requestId = request?.requestId?.trim();
    if (!requestId) throw new Error('Marketplace search request ID is required');
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
      return await service.search(request.params, controller.signal);
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
  });

  ipcMain.handle(MarketplaceIpcChannel.CancelSearch, (event, requestId: string) => {
    const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    if (!normalizedRequestId) return { cancelled: false };
    const key = searchKey(event.sender.id, normalizedRequestId);
    const controller = activeSearches.get(key);
    if (!controller) return { cancelled: false };
    controller.abort();
    activeSearches.delete(key);
    return { cancelled: true };
  });
}
