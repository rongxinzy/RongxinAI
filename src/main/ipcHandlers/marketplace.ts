import { ipcMain } from 'electron';

import { MarketplaceIpcChannel } from '../../shared/marketplace';
import { MarketplaceService } from '../libs/marketplaceService';
import { createModelScopeTokenPool } from '../libs/modelscopeTokenPool';

export function registerMarketplaceIpcHandlers(options: {
  getModelsDir: () => string;
}): void {
  const tokenPool = createModelScopeTokenPool();
  console.log(`[Marketplace] initialized ModelScope token pool with ${tokenPool.size()} token(s)`);
  const service = new MarketplaceService(options.getModelsDir, {
    getModelScopeToken: tokenPool.nextToken,
  });

  ipcMain.handle(MarketplaceIpcChannel.Search, async (_event, params) => {
    try {
      return await service.search(params);
    } catch (error) {
      console.warn('[Marketplace] search failed, falling back to curated models:', error);
      return { models: service.searchLocal(params) };
    }
  });
}
