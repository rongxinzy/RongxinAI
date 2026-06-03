import { ipcMain } from 'electron';

import { MarketplaceIpcChannel } from '../../shared/marketplace';
import { MarketplaceService } from '../libs/marketplaceService';
import { createModelScopeTokenPool } from '../libs/modelscopeTokenPool';

const STORE_KEY = 'marketplace_modelscope_token';

export function registerMarketplaceIpcHandlers(options: {
  getModelsDir: () => string;
  getStore: () => { get: (key: string) => unknown; set: (key: string, value: unknown) => void };
}): void {
  // Build token pool: user-configured token (from store) has highest priority,
  // followed by env var / .env / resource file tokens.
  let tokenPool = createModelScopeTokenPool();
  const userToken = options.getStore().get<string | null>(STORE_KEY);
  if (userToken) {
    // Prepend user token to the pool — it will be tried first.
    const existingTokens = collectExistingTokens(tokenPool);
    tokenPool = createModelScopeTokenPool({ extraTokens: [userToken, ...existingTokens] });
  }
  console.log(`[Marketplace] initialized ModelScope token pool with ${tokenPool.size()} token(s) (user=${!!userToken})`);
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

  ipcMain.handle(MarketplaceIpcChannel.GetToken, () => {
    return options.getStore().get<string | null>(STORE_KEY) ?? null;
  });

  ipcMain.handle(MarketplaceIpcChannel.SetToken, (_event, token: string) => {
    const trimmed = token.trim();
    if (!trimmed) {
      options.getStore().set(STORE_KEY, null);
      tokenPool = createModelScopeTokenPool();
    } else {
      options.getStore().set(STORE_KEY, trimmed);
      // Rebuild pool with user token first.
      const existingTokens = collectExistingTokens(createModelScopeTokenPool());
      tokenPool = createModelScopeTokenPool({ extraTokens: [trimmed, ...existingTokens] });
    }
    // Update the service's token getter to use the new pool.
    service.setTokenGetter(tokenPool.nextToken);
    console.log(`[Marketplace] user token ${trimmed ? 'updated' : 'cleared'}, pool size=${tokenPool.size()}`);
  });
}

/** Drain all tokens from a pool without advancing the internal cursor. */
function collectExistingTokens(pool: ReturnType<typeof createModelScopeTokenPool>): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const size = pool.size();
  for (let i = 0; i < size; i++) {
    const t = pool.nextToken();
    if (t && !seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  }
  return tokens;
}
