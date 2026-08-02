import { ipcMain, net } from 'electron';

import { MarketplaceIpcChannel } from '../../shared/marketplace';
import { MarketplaceService } from '../libs/marketplaceService';

export function registerMarketplaceIpcHandlers(options: {
  getModelsDir: () => string;
}): void {
  const service = new MarketplaceService(options.getModelsDir, {
    catalogApiUrl: process.env.ZHIYUAN_MODEL_CATALOG_URL?.trim() || undefined,
    fetchImpl: net.fetch,
  });

  ipcMain.handle(MarketplaceIpcChannel.Search, async (_event, params) => {
    try {
      return await service.search(params);
    } catch (error) {
      console.warn('[Marketplace] catalog search failed; using bundled GGUF recommendations:', error);
      return {
        models: service.searchLocal(params),
        source: 'curated' as const,
        warning: '云端 GGUF 目录暂时不可用，正在展示内置推荐。',
      };
    }
  });
}
