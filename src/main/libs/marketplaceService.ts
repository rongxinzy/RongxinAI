import fs from 'fs';
import path from 'path';

import type {
  MarketplaceModel,
  MarketplaceSearchParams,
  MarketplaceSearchResult,
} from '../../shared/marketplace';
import type { LocalModelCatalog } from './localModelCatalog';

export class MarketplaceService {
  constructor(
    private readonly getModelsDir: () => string,
    private readonly catalog: LocalModelCatalog,
  ) {}

  async search(
    params: MarketplaceSearchParams = {},
    signal?: AbortSignal,
  ): Promise<MarketplaceSearchResult> {
    signal?.throwIfAborted();
    const page = this.catalog.search(params);
    const root = this.getModelsDir().trim();
    const models = await Promise.all(
      page.models.map(async model => {
        if (!root) return model;
        const repoDir = path.join(root, 'modelscope', model.repoId);
        for (const file of model.files ?? []) {
          if (!file.path.toLowerCase().endsWith('.gguf') || file.kind === 'mmproj') continue;
          const installedPath = path.join(repoDir, file.path);
          const stats = await fs.promises.stat(installedPath).catch((): null => null);
          if (stats?.isFile() && stats.size > 0) {
            return { ...model, installed: true, installedPath };
          }
        }
        return { ...model, installed: false, installedPath: undefined };
      }),
    );
    signal?.throwIfAborted();
    return {
      models,
      totalCount: page.totalCount,
      nextCursor: page.nextCursor,
      hasMore: Boolean(page.nextCursor),
      catalogUpdatedAt: page.updatedAt,
      source: 'local-sqlite',
    };
  }

  async resolveModel(repoId: string): Promise<MarketplaceModel | null> {
    const normalizedRepoId = repoId.trim();
    return normalizedRepoId ? this.catalog.find(normalizedRepoId) : null;
  }
}
