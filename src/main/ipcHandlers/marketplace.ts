import { ipcMain, net } from 'electron';
import path from 'path';

import { MarketplaceIpcChannel } from '../../shared/marketplace';
import { MarketplaceService } from '../libs/marketplaceService';

export function registerMarketplaceIpcHandlers(options: {
  getModelsDir: () => string;
  userDataPath: string;
}): void {
  const service = new MarketplaceService(options.getModelsDir, {
    catalogApiUrl: process.env.ZHIYUAN_MODEL_CATALOG_URL?.trim() || undefined,
    fetchImpl: net.fetch,
    cacheDir: path.join(options.userDataPath, 'marketplace-cache'),
  });

  ipcMain.handle(MarketplaceIpcChannel.Search, async (_event, params) => {
    try {
      return await service.search(params);
    } catch (error) {
      console.warn('[Marketplace] catalog search failed:', error);
      return {
        models: [],
        totalCount: 0,
        source: 'cloud-catalog' as const,
        warning: '云端 GGUF 目录暂时不可用。',
      };
    }
  });
}
