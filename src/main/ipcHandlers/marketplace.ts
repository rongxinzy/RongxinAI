import { ipcMain } from 'electron';

import { MarketplaceIpcChannel } from '../../shared/marketplace';
import { MarketplaceService } from '../libs/marketplaceService';

export function registerMarketplaceIpcHandlers(options: {
  getModelsDir: () => string;
}): void {
  const service = new MarketplaceService(options.getModelsDir);

  ipcMain.handle(MarketplaceIpcChannel.Search, async (_event, params) => {
    try {
      return await service.search(params);
    } catch (error) {
      console.warn('[Marketplace] search failed, falling back to curated models:', error);
      return { models: service.searchLocal(params) };
    }
  });
}
